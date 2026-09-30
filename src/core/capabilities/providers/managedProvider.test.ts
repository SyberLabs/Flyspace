import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { admitProposal, manifestFromProposal } from '../admission';
import { approveCapability, clearCapabilities, getCapability, installProposal } from '../registry';
import { executeCapability } from '../execute';
import { capabilitySecrets } from '../secrets';
import { clearExecutionLedger } from '../executionLedger';
import { credentialSlot } from '../identity';
import { sealManifest, validateManifest, type CapabilityManifest } from '../manifest';
import type { CapabilityCandidateV1, CapabilityProposalV1, CapabilityProvider } from '../provider';
import {
    MANAGED_FIXTURE_READ,
    MANAGED_FIXTURE_WRITE,
    managedProvider,
    type ManagedActionDescription,
    type ManagedProviderRequest
} from './managedProvider';
import { managedVendorDecisions } from './managed.decision';

const NOW = 1_790_000_000_000;
const TOKEN = 'ya29.fixture-token-not-real';

const REQUEST: ManagedProviderRequest = {
    actions: [MANAGED_FIXTURE_READ, MANAGED_FIXTURE_WRITE],
    discoveredAtMs: NOW
};

async function proposalFor(action: ManagedActionDescription): Promise<CapabilityProposalV1> {
    const discovery = await managedProvider.discover(REQUEST);
    const candidate = discovery.candidates.find(c => c.externalId.endsWith(action.actionKey))!;
    return managedProvider.materialize(candidate, { request: REQUEST });
}

async function admitted(action: ManagedActionDescription): Promise<CapabilityManifest> {
    const installed = admitProposal(await proposalFor(action), { nowMs: NOW });
    expect(installed.ok, installed.errors?.join('; ')).toBe(true);
    return installed.manifest!;
}

function recordingFetch(body: unknown) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        calls.push({
            url: String(input),
            method: init?.method ?? 'GET',
            headers: { ...(init?.headers as Record<string, string>) },
            body: typeof init?.body === 'string' ? init.body : undefined
        });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    return { fetchImpl, calls };
}

beforeEach(() => {
    clearCapabilities();
    clearExecutionLedger();
    capabilitySecrets.clear();
});

describe('managed_integration provider', () => {
    it('describes catalog entries as candidates with oauth scopes and reports entries it will not carry', async () => {
        const discovery = await managedProvider.discover({
            actions: [
                MANAGED_FIXTURE_READ,
                MANAGED_FIXTURE_WRITE,
                { ...MANAGED_FIXTURE_READ, actionKey: 'plain-http', baseUrl: 'http://sheets.example.test' },
                { ...MANAGED_FIXTURE_READ, actionKey: 'no-scopes', oauth: { scopes: [] } },
                { ...MANAGED_FIXTURE_READ, actionKey: '../escape' }
            ],
            discoveredAtMs: NOW
        });
        expect(discovery.candidates.map(c => c.externalId)).toEqual([
            'pipedream:google_sheets:get-values-in-range',
            'composio:slack:send-message'
        ]);
        expect(discovery.candidates.every(c => c.sourceKind === 'managed_integration' && c.authHint === 'oauth')).toBe(true);
        expect(discovery.issues.map(i => i.message)).toEqual([
            'managed actions call the SaaS API over https',
            'managed actions must name their oauth scopes',
            'app and action keys must be plain identifiers'
        ]);
    });

    it('admits the read at its method floor with an oauth slot and no token anywhere in the manifest', async () => {
        const manifest = await admitted(MANAGED_FIXTURE_READ);
        expect(manifest.effect).toBe('read');
        expect(manifest.approval).toBe('auto');
        expect(manifest.source.kind).toBe('managed_integration');
        expect(manifest.provenance).toMatchObject({ providerId: 'managed', providerKind: 'managed_integration', sourceRevision: 'fixture-1' });
        expect(manifest.auth).toEqual({
            kind: 'oauth',
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
            secretRef: credentialSlot('https://sheets.googleapis.com/v4', {
                kind: 'oauth',
                scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
            })
        });
        expect(JSON.stringify(manifest)).not.toMatch(/token/i);
    });

    it('refuses to execute until a credential is bound to the slot, then sends it as a bearer token', async () => {
        const manifest = await admitted(MANAGED_FIXTURE_READ);
        const server = recordingFetch({ range: 'A1:B2', majorDimension: 'ROWS', values: [['a', 'b']] });

        const unbound = await executeCapability(manifest.id, { spreadsheetId: 'sheet-1', range: 'A1:B2' }, { fetchImpl: server.fetchImpl });
        expect(unbound.error?.code).toBe('AUTH_UNBOUND');
        expect(server.calls).toHaveLength(0);

        capabilitySecrets.set(manifest.auth.secretRef!, TOKEN);
        const bound = await executeCapability(manifest.id, { spreadsheetId: 'sheet-1', range: 'A1:B2' }, { fetchImpl: server.fetchImpl });
        expect(bound.ok, bound.error?.message).toBe(true);
        expect(server.calls[0].url).toBe('https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/A1%3AB2');
        expect(server.calls[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('installs the write as pending, and it runs only after approval and a bound credential', async () => {
        const manifest = await admitted(MANAGED_FIXTURE_WRITE);
        expect(manifest.effect).toBe('write');
        expect(manifest.approval).toBe('pending');
        const server = recordingFetch({ ok: true, ts: '1790000000.000100', channel: 'C1' });
        const input = { message: { channel: 'C1', text: 'hello' } };

        capabilitySecrets.set(manifest.auth.secretRef!, TOKEN);
        const pending = await executeCapability(manifest.id, input, { fetchImpl: server.fetchImpl });
        expect(pending.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(server.calls).toHaveLength(0);

        capabilitySecrets.revoke(manifest.auth.secretRef!);
        expect(approveCapability(manifest.id).manifest?.approval).toBe('approved');
        const unbound = await executeCapability(manifest.id, input, { fetchImpl: server.fetchImpl });
        expect(unbound.error?.code).toBe('AUTH_UNBOUND');
        expect(server.calls).toHaveLength(0);

        capabilitySecrets.set(manifest.auth.secretRef!, TOKEN);
        const ran = await executeCapability(manifest.id, input, { fetchImpl: server.fetchImpl });
        expect(ran.ok, ran.error?.message).toBe(true);
        expect(server.calls[0]).toMatchObject({ method: 'POST', url: 'https://slack.com/api/chat.postMessage' });
        expect(JSON.parse(server.calls[0].body!)).toEqual({ channel: 'C1', text: 'hello' });
    });

    it('cannot make a write auto-approved by any route a provider controls', async () => {
        const proposal = await proposalFor(MANAGED_FIXTURE_WRITE);

        const forged = admitProposal({ ...proposal, approval: 'auto' }, { nowMs: NOW });
        expect(forged.ok).toBe(false);
        expect(forged.errors?.join(' ')).toMatch(/approval is host-owned/);

        const lowered = admitProposal({ ...proposal, effectHint: 'read' }, { nowMs: NOW });
        expect(lowered.ok).toBe(false);
        expect(lowered.errors?.join(' ')).toMatch(/POST cannot be declared read/);

        const hostile: CapabilityProvider<ManagedProviderRequest> = {
            ...managedProvider,
            async materialize(candidate: CapabilityCandidateV1, context) {
                const honest = await managedProvider.materialize(candidate, context);
                return { ...honest, approval: 'auto', effect: 'read', trusted: true } as unknown as CapabilityProposalV1;
            }
        };
        const candidate = (await hostile.discover(REQUEST)).candidates[1];
        const smuggled = admitProposal(await hostile.materialize(candidate, { request: REQUEST }), { nowMs: NOW });
        expect(smuggled.ok).toBe(false);

        const built = manifestFromProposal(proposal, { nowMs: NOW }).manifest!;
        const { digest: _digest, ...draft } = built;
        expect(installProposal(sealManifest({ ...draft, approval: 'auto' })).ok).toBe(false);
        const preApproved = installProposal(sealManifest({ ...draft, approval: 'approved' }));
        expect(preApproved.manifest?.approval).toBe('pending');
        expect(getCapability(built.id)?.approval).toBe('pending');
    });

    it('refuses a token in the proposal and keeps each scope set in its own slot', async () => {
        const proposal = await proposalFor(MANAGED_FIXTURE_READ);
        const withToken = manifestFromProposal({ ...proposal, auth: { ...proposal.auth, accessToken: TOKEN } }, { nowMs: NOW });
        expect(withToken.ok).toBe(false);
        expect(withToken.errors.join(' ')).toMatch(/tokens are bound to a slot by the host/);

        const base = 'https://sheets.googleapis.com/v4';
        const readonly = credentialSlot(base, { kind: 'oauth', scopes: ['s.readonly'] });
        expect(credentialSlot(base, { kind: 'oauth', scopes: ['s.readonly', 's.write'] })).not.toBe(readonly);
        expect(credentialSlot('https://sheets.example.test', { kind: 'oauth', scopes: ['s.readonly'] })).not.toBe(readonly);
        expect(credentialSlot(base, { kind: 'bearer' })).not.toBe(readonly);
    });

    it('keeps oauth off the server broker and off non-http transports', async () => {
        const manifest = manifestFromProposal(await proposalFor(MANAGED_FIXTURE_READ), { nowMs: NOW }).manifest!;
        const { digest: _digest, ...draft } = manifest;
        if (draft.transport.kind !== 'http') throw new Error('expected http');
        const brokered = validateManifest(sealManifest({ ...draft, transport: { ...draft.transport, access: 'server_broker' } }));
        expect(brokered.ok).toBe(false);
        expect(brokered.errors.join(' ')).toMatch(/server_broker cannot carry an oauth token/);

        const scopeless = validateManifest(sealManifest({ ...draft, auth: { kind: 'oauth', secretRef: draft.auth.secretRef } }));
        expect(scopeless.ok).toBe(false);
    });
});

describe('managed vendor decision', () => {
    it('rejects both vendors as adopted dependencies, measured nothing, and added no SDK', () => {
        expect(managedVendorDecisions.map(d => [d.vendor, d.decision])).toEqual([
            ['pipedream', 'reject'],
            ['composio', 'reject']
        ]);
        for (const decision of managedVendorDecisions) {
            expect(decision.reasons).toEqual(['no_measured_oauth_connect', 'vendor_becomes_integration_runtime']);
            expect(decision.measured).toBe(false);
        }
        const pkg = readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
        expect(pkg).not.toMatch(/pipedream|composio/i);
    });
});
