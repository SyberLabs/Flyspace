import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { admitProposal, manifestFromProposal } from '../admission';
import { approveCapability, clearCapabilities, getCapability } from '../registry';
import { executeCapability } from '../execute';
import { capabilitySecrets } from '../secrets';
import { clearExecutionLedger, executionRecord, executionRecords } from '../executionLedger';
import { bindAsyncRuntime, unbindAsyncRuntime, type AsyncClock } from '../asyncRuntime';
import { transportCredentialSlot } from '../identity';
import { useBlockStore } from '../../stores/blockStore';
import { useWireStore } from '../../stores/wireStore';
import {
    MAXUN_DEFAULT_PROFILE,
    maxunProvider,
    type MaxunProviderRequest,
    type MaxunRobotDescription
} from './maxunProvider';
import { createMaxunRuntime } from './maxunRuntime';
import { maxunEvaluation } from './maxun.evaluation';

const NOW = 1_790_000_000_000;
const KEY = 'maxun-fixture-key-not-real';
const BASE = 'https://maxun.fixture.test';
const SLOT = transportCredentialSlot(
    { kind: 'async', runtimeId: 'maxun', operation: 'x' },
    { kind: 'apiKey', in: 'header', name: 'x-api-key' }
)!;

const ROBOTS: MaxunRobotDescription[] = [
    { id: 'rb-pricing', name: 'Pricing page', mode: 'scrape', updatedAt: '2026-09-29T10:00:00Z' },
    { id: 'rb-listing', name: 'Listing fields', mode: 'extract', fields: ['title', 'price'] },
    { id: 'rb-loose', name: 'No declared fields', mode: 'extract' },
    { id: 'rb-crawl', name: 'Crawl a site', mode: 'crawl' },
    { id: 'bad id/../x', name: 'Path in id', mode: 'scrape' }
];

function request(overrides: Partial<MaxunProviderRequest> = {}): MaxunProviderRequest {
    return { robots: ROBOTS, sourceLocator: 'maxun:fixture', discoveredAtMs: NOW, ...overrides };
}

function virtualClock(start = NOW): AsyncClock {
    let now = start;
    return {
        now: () => now,
        async sleep(ms, signal) {
            if (signal?.aborted) throw new Error('aborted');
            now += ms;
            await Promise.resolve();
        }
    };
}

// ---------------------------------------------------------------------------
// A local stand-in for Maxun's REST run endpoints. It follows the documented
// shape: POST /api/robots/{id}/runs returns { runId, status }, and
// GET /api/robots/{id}/runs/{runId} returns { runId, status, data }. It is not
// Maxun and measures nothing about Maxun.
// ---------------------------------------------------------------------------

interface FixtureRun { runId: string; robotId: string; startedAt: number }

function maxunServer(clock: AsyncClock, options: {
    finishAfterMs?: number;
    startStatus?: number;
    pollStatus?: string;
    data?: Record<string, unknown>;
} = {}) {
    const runs = new Map<string, FixtureRun>();
    const seen: Array<{ method: string; url: string; headers: Record<string, string>; redirect?: RequestRedirect }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const headers = { ...(init?.headers as Record<string, string>) };
        seen.push({ method: init?.method ?? 'GET', url, headers, redirect: init?.redirect });
        if (headers['x-api-key'] !== KEY) return json(401, { error: 'Unauthorized' });
        const start = /^https:\/\/maxun\.fixture\.test\/api\/robots\/([^/]+)\/runs$/.exec(url);
        if (start && init?.method === 'POST') {
            if (options.startStatus) return json(options.startStatus, { error: 'nope' });
            const run = { runId: `mx-run-${runs.size + 1}`, robotId: decodeURIComponent(start[1]), startedAt: clock.now() };
            runs.set(run.runId, run);
            return json(200, { runId: run.runId, status: 'running' });
        }
        const poll = /^https:\/\/maxun\.fixture\.test\/api\/robots\/([^/]+)\/runs\/([^/]+)$/.exec(url);
        if (poll) {
            const run = runs.get(decodeURIComponent(poll[2]));
            if (!run) return json(404, { error: 'not found' });
            const done = clock.now() - run.startedAt >= (options.finishAfterMs ?? 45_000);
            if (!done) return json(200, { runId: run.runId, status: 'running' });
            return json(200, {
                runId: run.runId,
                status: options.pollStatus ?? 'success',
                data: options.data ?? { markdown: '# Plans\nPro $12', html: '<h1>Plans</h1>', textData: {}, listData: [] }
            });
        }
        return json(404, { error: 'no route' });
    };
    return { fetchImpl, seen, runs };
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function install(robotId: string, policy: Parameters<typeof admitProposal>[1] = { nowMs: NOW }) {
    const discovery = await maxunProvider.discover(request());
    const candidate = discovery.candidates.find(c => c.externalId === robotId)!;
    const proposal = await maxunProvider.materialize(candidate, { request: request() });
    const installed = admitProposal(proposal, policy);
    expect(installed.ok, installed.errors?.join('; ')).toBe(true);
    return installed.manifest!;
}

beforeEach(() => {
    clearCapabilities();
    clearExecutionLedger();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [] });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    unbindAsyncRuntime('maxun');
    capabilitySecrets.clear();
});

describe('maxun web_data provider', () => {
    it('lists scrape and typed extract robots and reports what it cannot type', async () => {
        const discovery = await maxunProvider.discover(request());
        expect(discovery.candidates.map(c => c.externalId)).toEqual(['rb-pricing', 'rb-listing']);
        expect(discovery.candidates.every(c => c.sourceKind === 'web_data' && c.lifecycleHint === 'async')).toBe(true);
        const issues = Object.fromEntries(discovery.issues.map(issue => [issue.externalId ?? '?', issue.message]));
        expect(issues['rb-loose']).toMatch(/not admitted as any/);
        expect(issues['rb-crawl']).toMatch(/no typed result/);
        expect(issues['bad id/../x']).toMatch(/plain identifier/);
    });

    it('materializes an async proposal whose key is a slot, not a manifest field', async () => {
        const discovery = await maxunProvider.discover(request());
        const proposal = await maxunProvider.materialize(discovery.candidates[0], { request: request() });
        expect(proposal.transport).toEqual({ kind: 'async', runtimeId: 'maxun', operation: 'scrape:rb-pricing' });
        expect(proposal.execution).toEqual({ kind: 'async_poll', ...MAXUN_DEFAULT_PROFILE });
        expect(proposal.auth).toEqual({ kind: 'apiKey', in: 'header', name: 'x-api-key' });
        expect(proposal).not.toHaveProperty('approval');

        const manifest = manifestFromProposal(proposal, { nowMs: NOW }).manifest!;
        expect(manifest.source).toMatchObject({ kind: 'web_data', operationId: 'rb-pricing' });
        expect(manifest.provenance).toMatchObject({
            providerId: 'maxun',
            providerKind: 'web_data',
            externalId: 'rb-pricing',
            sourceLocator: 'maxun:fixture/robots/rb-pricing',
            sourceRevision: '2026-09-29T10:00:00Z'
        });
        expect(manifest.auth.secretRef).toBe(SLOT);
        expect(manifest.output.schema).toMatchObject({ kind: 'object', required: ['markdown'] });
        expect(JSON.stringify(manifest)).not.toMatch(/maxun-fixture-key/);
    });

    it('lands at write and pending until the host trusts the runtime; the provider cannot approve itself', async () => {
        const untrusted = await install('rb-pricing');
        expect(untrusted.effect).toBe('write');
        expect(untrusted.approval).toBe('pending');

        clearCapabilities();
        const trusted = await install('rb-pricing', { nowMs: NOW, trustedEffectHints: { asyncRuntimes: ['maxun'] } });
        expect(trusted.effect).toBe('read');
        expect(trusted.approval).toBe('auto');

        const discovery = await maxunProvider.discover(request());
        const proposal = await maxunProvider.materialize(discovery.candidates[0], { request: request() });
        const forged = admitProposal({ ...proposal, approval: 'approved', auth: { ...proposal.auth, secretRef: 'someone-elses-slot' } });
        expect(forged.ok).toBe(false);
    });

    it('does not touch canvas state and keeps Maxun code away from blocks and wires', async () => {
        await install('rb-pricing');
        expect(useBlockStore.getState().blocks).toHaveLength(0);
        expect(useWireStore.getState().wires).toHaveLength(0);
        for (const file of ['maxunProvider.ts', 'maxunRuntime.ts', 'maxun.evaluation.ts']) {
            const source = readFileSync(path.join(__dirname, file), 'utf8');
            expect(source).not.toMatch(/stores\/|blockStore|wireStore|restoreSnapshot|approveCapability/);
        }
    });
});

describe('maxun runtime through the async profile', () => {
    it('runs a scrape robot past the 15s request timeout and returns a typed value', async () => {
        const clock = virtualClock();
        const server = maxunServer(clock, { finishAfterMs: 45_000 });
        bindAsyncRuntime('maxun', createMaxunRuntime({ baseUrl: BASE, fetch: server.fetchImpl }));
        capabilitySecrets.set(SLOT, KEY);
        const manifest = await install('rb-pricing');
        approveCapability(manifest.id);

        const result = await executeCapability(manifest.id, {}, { clock });
        expect(result.ok, result.error?.message).toBe(true);
        expect(result.typed?.value).toEqual({ markdown: '# Plans\nPro $12' });
        expect(clock.now() - NOW).toBeGreaterThan(15_000);

        const posts = server.seen.filter(call => call.method === 'POST');
        expect(posts).toHaveLength(1);
        expect(posts[0].url).toBe(`${BASE}/api/robots/rb-pricing/runs`);
        expect(server.seen.every(call => call.headers['x-api-key'] === KEY && call.redirect === 'error')).toBe(true);
        expect(executionRecord(result.runId!)).toMatchObject({
            status: 'succeeded',
            providerId: 'maxun',
            externalRunId: 'mx-run-1',
            executionProfile: 'async_poll'
        });
        expect(JSON.stringify(executionRecords())).not.toContain(KEY);
    });

    it('types an extract robot by its declared fields and refuses a result that lacks one', async () => {
        const clock = virtualClock();
        capabilitySecrets.set(SLOT, KEY);
        const manifest = await install('rb-listing');
        approveCapability(manifest.id);

        bindAsyncRuntime('maxun', createMaxunRuntime({
            baseUrl: BASE,
            fetch: maxunServer(clock, { data: { textData: { title: 'Desk', price: '$120' } } }).fetchImpl
        }));
        const ok = await executeCapability(manifest.id, {}, { clock });
        expect(ok.typed?.value).toEqual({ title: 'Desk', price: '$120' });

        bindAsyncRuntime('maxun', createMaxunRuntime({
            baseUrl: BASE,
            fetch: maxunServer(clock, { data: { textData: { title: 'Desk' } } }).fetchImpl
        }));
        const partial = await executeCapability(manifest.id, {}, { clock });
        expect(partial.error?.code).toBe('TYPED_OUTPUT_MISMATCH');
    });

    it('fails the next run deterministically after the slot is revoked and keeps the definition', async () => {
        const clock = virtualClock();
        const server = maxunServer(clock);
        bindAsyncRuntime('maxun', createMaxunRuntime({ baseUrl: BASE, fetch: server.fetchImpl }));
        capabilitySecrets.set(SLOT, KEY);
        const manifest = await install('rb-pricing');
        approveCapability(manifest.id);
        expect((await executeCapability(manifest.id, {}, { clock })).ok).toBe(true);
        const calls = server.seen.length;

        capabilitySecrets.revoke(SLOT);
        const first = await executeCapability(manifest.id, {}, { clock });
        const second = await executeCapability(manifest.id, {}, { clock });
        expect(first.error?.code).toBe('AUTH_UNBOUND');
        expect(second.error?.code).toBe('AUTH_UNBOUND');
        expect(server.seen.length).toBe(calls);
        expect(getCapability(manifest.id)?.approval).toBe('approved');
    });

    it('treats a refused start as failed and an ambiguous one as uncertain', async () => {
        const clock = virtualClock();
        capabilitySecrets.set(SLOT, 'wrong-key');
        bindAsyncRuntime('maxun', createMaxunRuntime({ baseUrl: BASE, fetch: maxunServer(clock).fetchImpl }));
        const manifest = await install('rb-pricing');
        approveCapability(manifest.id);
        const refused = await executeCapability(manifest.id, {}, { clock });
        expect(refused.error?.code).toBe('ASYNC_START_REJECTED');
        expect(refused.error?.message).toMatch(/401/);

        capabilitySecrets.set(SLOT, KEY);
        for (const status of [500, 409]) {
            bindAsyncRuntime('maxun', createMaxunRuntime({ baseUrl: BASE, fetch: maxunServer(clock, { startStatus: status }).fetchImpl }));
            const ambiguous = await executeCapability(manifest.id, {}, { clock });
            expect(ambiguous.error?.code).toBe('EFFECT_UNCERTAIN');
        }
    });

    it('reports a failed robot run and never reads an unknown status as success', async () => {
        const clock = virtualClock();
        capabilitySecrets.set(SLOT, KEY);
        const manifest = await install('rb-pricing');
        approveCapability(manifest.id);

        bindAsyncRuntime('maxun', createMaxunRuntime({ baseUrl: BASE, fetch: maxunServer(clock, { pollStatus: 'failed' }).fetchImpl }));
        expect((await executeCapability(manifest.id, {}, { clock })).error?.code).toBe('ASYNC_RUN_FAILED');

        bindAsyncRuntime('maxun', createMaxunRuntime({ baseUrl: BASE, fetch: maxunServer(clock, { pollStatus: 'mystery', finishAfterMs: 0 }).fetchImpl }));
        const unknown = await executeCapability(manifest.id, {}, { clock });
        expect(unknown.ok).toBe(false);
        expect(unknown.error?.code).toBe('EFFECT_UNCERTAIN');
    });

    it('refuses a non-https or credential-bearing base URL', () => {
        expect(() => createMaxunRuntime({ baseUrl: 'http://maxun.fixture.test' })).toThrow(/https/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://user:pw@maxun.fixture.test' })).toThrow(/credentials/);
    });
});

describe('maxun evaluation record', () => {
    it('says no live run was performed when MAXUN_API_KEY is unset', () => {
        if (process.env.MAXUN_API_KEY) return;
        expect(maxunEvaluation).toEqual({ measured: false, reason: 'MAXUN_API_KEY unset' });
    });
});
