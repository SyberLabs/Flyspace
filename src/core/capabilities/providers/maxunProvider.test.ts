import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { admitProposal, manifestFromProposal } from '../admission';
import { approveCapability, clearCapabilities, getCapability } from '../registry';
// Write runs need a confirmed preview; these tests exercise the engine after one.
import { executeConfirmed as executeCapability } from '../../../../test/confirmedExecute';
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
/** Public answer supplied by the test. The runtime does not resolve this name. */
const PUBLIC_ADDRESSES = [{ address: '1.1.1.1' }];

function boundRuntime(fetchImpl: typeof fetch) {
    return createMaxunRuntime({ baseUrl: BASE, fetch: fetchImpl, addresses: PUBLIC_ADDRESSES });
}
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
// A local stand-in for Maxun's run lookup, GET /api/robots/{id}/runs/{runId},
// in the shape that handler returns in the open-source server:
// { statusCode, messageCode, run: { runId, status, data } }. It is not Maxun and
// measures nothing about Maxun.
// ---------------------------------------------------------------------------

function maxunRunLookup(run: { runId: string; status: string; data?: Record<string, unknown> }) {
    const seen: Array<{ method: string; url: string; headers: Record<string, string>; redirect?: RequestRedirect }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        const headers = { ...(init?.headers as Record<string, string>) };
        seen.push({ method: init?.method ?? 'GET', url, headers, redirect: init?.redirect });
        if (headers['x-api-key'] !== KEY) return json(401, { ok: false, error: 'Unauthorized' });
        if (init?.method !== 'GET' || !/^https:\/\/maxun\.fixture\.test\/api\/robots\/[^/]+\/runs\/[^/]+$/.test(url)) {
            return json(404, { error: 'no route' });
        }
        return json(200, { statusCode: 200, messageCode: 'success', run });
    };
    return { fetchImpl, seen };
}

const LOOKUP = { headers: { 'x-api-key': KEY }, idempotencyKey: 'lookup-0001' };

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

// ---------------------------------------------------------------------------
// The start contract Maxun's open-source server actually implements
// (getmaxun/maxun server/src/api/record.ts, POST /robots/:id/runs, at
// e17d5ed33a3c90220fba54c78f449a1f55043cb9 and unchanged at develop
// bf3187eff7f644bfbcc1c130fb85bad332bbd420): the handler awaits
// waitForRunCompletion before it answers, so the run id arrives only with the
// finished run. The SDK route POST /sdk/robots/:id/execute waits the same way.
// This fixture holds the POST until the run completes or the caller aborts.
// ---------------------------------------------------------------------------

function blockingMaxunServer() {
    const seen: Array<{ method: string; url: string }> = [];
    let markPosted: () => void = () => {};
    const posted = new Promise<void>(resolve => { markPosted = resolve; });
    const fetchImpl: typeof fetch = async (input, init) => {
        const url = String(input);
        seen.push({ method: init?.method ?? 'GET', url });
        if (init?.method === 'POST') {
            markPosted();
            // The run outlives the request: nothing comes back before the abort.
            return new Promise<Response>((_resolve, reject) => {
                const abort = () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
                if (init.signal?.aborted) abort();
                init.signal?.addEventListener('abort', abort, { once: true });
            });
        }
        return json(404, { statusCode: 404, messageCode: 'not_found' });
    };
    return { fetchImpl, seen, posted };
}

describe('maxun start contract', () => {
    it('sends no start while the only verified start holds the request until the run finishes', async () => {
        const clock = virtualClock();
        const server = blockingMaxunServer();
        bindAsyncRuntime('maxun', boundRuntime(server.fetchImpl));
        capabilitySecrets.set(SLOT, KEY);
        const manifest = await install('rb-pricing');
        approveCapability(manifest.id);

        // The abort stands in for the 15 s request timeout firing before the run completes.
        const controller = new AbortController();
        const pending = executeCapability(manifest.id, {}, { clock, signal: controller.signal, idempotencyKey: 'blocking-start-01' });
        await Promise.race([server.posted.then(() => controller.abort()), pending]);
        const result = await pending;

        expect(server.seen.filter(call => call.method === 'POST')).toHaveLength(0);
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('ASYNC_START_REJECTED');
        expect(result.error?.message).toMatch(/no verified asynchronous start contract/);
        const record = executionRecord(result.runId!)!;
        expect(record.status).toBe('failed');
        expect(record.externalRunId).toBeUndefined();

        const replay = await executeCapability(manifest.id, {}, { clock, idempotencyKey: 'blocking-start-01' });
        expect(replay.error?.code).toBe('ASYNC_START_REJECTED');
        expect(server.seen).toHaveLength(0);
    });
});

describe('maxun runtime through the async profile', () => {
    it('reads a scrape run by id and returns only the typed markdown', async () => {
        const server = maxunRunLookup({
            runId: 'mx-run-1',
            status: 'success',
            data: { markdown: '# Plans', html: '<h1>Plans</h1>', textData: {}, listData: {} }
        });
        const runtime = boundRuntime(server.fetchImpl);
        const observed = await runtime.poll('scrape:rb-pricing', 'mx-run-1', { ...LOOKUP, signal: new AbortController().signal });
        expect(observed).toEqual({ status: 'succeeded', value: { markdown: '# Plans' } });
        expect(server.seen).toHaveLength(1);
        expect(server.seen[0]).toMatchObject({ method: 'GET', url: `${BASE}/api/robots/rb-pricing/runs/mx-run-1`, redirect: 'error' });
        expect(server.seen[0].headers['x-api-key']).toBe(KEY);
    });

    it('reads an extract run as its text captures', async () => {
        const runtime = boundRuntime(maxunRunLookup({
            runId: 'mx-run-2',
            status: 'success',
            data: { textData: { title: 'Desk', price: '$120' } }
        }).fetchImpl);
        const observed = await runtime.poll('extract:rb-listing', 'mx-run-2', { ...LOOKUP, signal: new AbortController().signal });
        expect(observed).toEqual({ status: 'succeeded', value: { title: 'Desk', price: '$120' } });
    });

    it('reports a failed robot run, refuses another run id, and never reads an unknown status as success', async () => {
        const signal = new AbortController().signal;
        const failed = boundRuntime(maxunRunLookup({ runId: 'mx-run-3', status: 'failed' }).fetchImpl);
        expect(await failed.poll('scrape:rb-pricing', 'mx-run-3', { ...LOOKUP, signal }))
            .toEqual({ status: 'failed', message: 'Maxun run failed' });

        const swapped = boundRuntime(maxunRunLookup({ runId: 'mx-run-other', status: 'success', data: { markdown: 'x' } }).fetchImpl);
        await expect(swapped.poll('scrape:rb-pricing', 'mx-run-3', { ...LOOKUP, signal })).rejects.toThrow(/different run/);

        const unknown = boundRuntime(maxunRunLookup({ runId: 'mx-run-4', status: 'mystery' }).fetchImpl);
        await expect(unknown.poll('scrape:rb-pricing', 'mx-run-4', { ...LOOKUP, signal })).rejects.toThrow(/not understood/);
    });

    it('fails deterministically after the slot is revoked and keeps the definition', async () => {
        const clock = virtualClock();
        const server = blockingMaxunServer();
        bindAsyncRuntime('maxun', boundRuntime(server.fetchImpl));
        capabilitySecrets.set(SLOT, KEY);
        const manifest = await install('rb-pricing');
        approveCapability(manifest.id);

        capabilitySecrets.revoke(SLOT);
        const first = await executeCapability(manifest.id, {}, { clock });
        const second = await executeCapability(manifest.id, {}, { clock });
        expect(first.error?.code).toBe('AUTH_UNBOUND');
        expect(second.error?.code).toBe('AUTH_UNBOUND');
        expect(server.seen).toHaveLength(0);
        expect(getCapability(manifest.id)?.approval).toBe('approved');
        expect(JSON.stringify(executionRecords())).not.toContain(KEY);
    });

    it('refuses a non-https or credential-bearing base URL', () => {
        expect(() => createMaxunRuntime({ baseUrl: 'http://maxun.fixture.test' })).toThrow(/https/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://user:pw@maxun.fixture.test' })).toThrow(/credentials/);
    });

    it('allows the pinned origin without addresses and refuses loopback, private, and metadata bases', () => {
        expect(() => createMaxunRuntime()).not.toThrow();
        expect(() => createMaxunRuntime({ baseUrl: 'https://app.maxun.dev/robots' })).not.toThrow();
        expect(() => createMaxunRuntime({ baseUrl: BASE, addresses: PUBLIC_ADDRESSES })).not.toThrow();

        expect(() => createMaxunRuntime({ baseUrl: BASE })).toThrow(/did not resolve/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://127.0.0.1' })).toThrow(/public address/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://[::1]' })).toThrow(/public address/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://10.1.2.3' })).toThrow(/public address/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://localhost' })).toThrow(/public origin/);
        expect(() => createMaxunRuntime({ baseUrl: 'https://metadata.google.internal' })).toThrow(/public origin/);
        expect(() => createMaxunRuntime({
            baseUrl: BASE,
            addresses: [{ address: '1.1.1.1' }, { address: '127.0.0.1' }]
        })).toThrow(/non-public/);
    });
});

describe('maxun evaluation record', () => {
    it('says no live run was performed when MAXUN_API_KEY is unset', () => {
        if (process.env.MAXUN_API_KEY) return;
        expect(maxunEvaluation).toEqual({ measured: false, reason: 'MAXUN_API_KEY unset' });
    });
});
