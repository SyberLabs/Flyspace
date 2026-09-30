import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { admitProposal, manifestFromProposal } from './admission';
import { approveCapability, clearCapabilities, installProposal } from './registry';
import { executeCapability, recoverAsyncExecutions, reconcileAsyncExecution } from './execute';
import { transportCredentialSlot } from './identity';
import { capabilitySecrets } from './secrets';
import {
    clearExecutionLedger,
    executionRecord,
    executionRecords,
    useExecutionLedger
} from './executionLedger';
import {
    AsyncStartRejected,
    bindAsyncRuntime,
    unbindAsyncRuntime,
    type AsyncClock,
    type AsyncJobRuntime,
    type AsyncObservation
} from './asyncRuntime';
import { sealManifest, validateManifest, type CapabilityManifest } from './manifest';
import type { CapabilityProposalV1 } from './provider';
import { memoryLedger } from '../services/server/capability.ledger';
import { vaultStorage, __resetVaultConnection } from '../vault/vaultStorage';

const KEY = 'mx-test-key-not-a-real-secret';
const SLOT = transportCredentialSlot(
    { kind: 'async', runtimeId: 'maxun', operation: 'robot-42' },
    { kind: 'apiKey', in: 'header', name: 'x-api-key' }
)!;
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Injected time. Nothing here waits on the wall clock.
// ---------------------------------------------------------------------------

interface TestClock extends AsyncClock {
    slept: number[];
}

function abortError(): Error {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
}

function virtualClock(start = Date.now()): TestClock {
    let now = start;
    const slept: number[] = [];
    return {
        slept,
        now: () => now,
        async sleep(ms, signal) {
            if (signal?.aborted) throw abortError();
            slept.push(ms);
            now += ms;
            await Promise.resolve();
            if (signal?.aborted) throw abortError();
        }
    };
}

/** Sleeps stop at a gate the test opens, so a run can be caught mid-poll. */
function gatedClock(start = Date.now()): TestClock & { parked: Promise<void>; open(): void } {
    const inner = virtualClock(start);
    let open: () => void = () => {};
    let parkedResolve: () => void = () => {};
    const parked = new Promise<void>(resolve => { parkedResolve = resolve; });
    const gate = new Promise<void>(resolve => { open = resolve; });
    return {
        ...inner,
        parked,
        open: () => open(),
        async sleep(ms, signal) {
            parkedResolve();
            await new Promise<void>((resolve, reject) => {
                if (signal?.aborted) return reject(abortError());
                signal?.addEventListener('abort', () => reject(abortError()), { once: true });
                void gate.then(resolve);
            });
            await inner.sleep(ms, signal);
        }
    };
}

// ---------------------------------------------------------------------------
// A runtime that speaks Maxun's run shape: POST /api/robots/{id}/runs returns
// { runId, status }, GET .../runs/{runId} returns the run with `data`. This is
// a fixture. It measures nothing about Maxun.
// ---------------------------------------------------------------------------

interface MaxunRun {
    runId: string;
    robotId: string;
    status: 'queued' | 'running' | 'success' | 'failed';
    startedAtMs: number;
    data?: { markdown?: string; textData?: Record<string, string>; listData?: unknown[] };
    error?: string;
}

interface FixtureOptions {
    finishAfterMs?: number;
    outcome?: 'success' | 'failed' | 'malformed';
    rejectStart?: boolean;
    throwOnStart?: boolean;
    pollFailures?: number;
}

function maxunFixture(clock: AsyncClock, options: FixtureOptions = {}) {
    const finishAfterMs = options.finishAfterMs ?? 42_000;
    const runs = new Map<string, MaxunRun>();
    const calls = { start: 0, poll: 0, headers: [] as Record<string, string>[], idempotencyKeys: [] as string[] };
    let pollFailures = options.pollFailures ?? 0;

    function fromMaxun(run: MaxunRun): AsyncObservation {
        if (run.status === 'success') return { status: 'succeeded', value: run.data };
        if (run.status === 'failed') return { status: 'failed', message: run.error ?? 'robot run failed' };
        return { status: 'running' };
    }

    const runtime: AsyncJobRuntime = {
        async start(robotId, _args, call) {
            calls.start += 1;
            calls.headers.push({ ...call.headers });
            calls.idempotencyKeys.push(call.idempotencyKey);
            if (call.headers['x-api-key'] !== KEY || options.rejectStart) {
                throw new AsyncStartRejected('401 Unauthorized: invalid API key');
            }
            if (options.throwOnStart) throw new Error('socket hang up');
            const run: MaxunRun = { runId: `run_${calls.start}`, robotId, status: 'queued', startedAtMs: clock.now() };
            runs.set(run.runId, run);
            return { externalRunId: run.runId };
        },
        async poll(_robotId, runId, call) {
            calls.poll += 1;
            calls.headers.push({ ...call.headers });
            if (pollFailures > 0) {
                pollFailures -= 1;
                throw new Error('502 Bad Gateway');
            }
            const run = runs.get(runId);
            if (!run) throw new Error(`404 run ${runId} not found`);
            if (clock.now() - run.startedAtMs >= finishAfterMs) {
                if (options.outcome === 'failed') {
                    run.status = 'failed';
                    run.error = 'selector not found';
                } else {
                    run.status = 'success';
                    run.data = options.outcome === 'malformed'
                        ? { textData: { price: '12' } }
                        : { markdown: '# Pricing\nPro: $12' };
                }
            } else {
                run.status = 'running';
            }
            return fromMaxun(run);
        }
    };
    return { runtime, runs, calls };
}

const NOW = 1_790_000_000_000;

function asyncProposal(overrides: Partial<CapabilityProposalV1> = {}): CapabilityProposalV1 {
    return {
        version: 1,
        provider: { id: 'fixture.jobs', kind: 'manual' },
        externalIdentity: { operationId: 'robot-42', sourceLocator: 'fixture://maxun/robot-42' },
        title: 'Scrape pricing page',
        auth: { kind: 'apiKey', in: 'header', name: 'x-api-key' },
        transport: { kind: 'async', runtimeId: 'maxun', operation: 'robot-42' },
        inputs: [{ name: 'url', in: 'argument', required: false, schema: { kind: 'string' } }],
        output: {
            schema: { kind: 'object', properties: { markdown: { kind: 'string' } }, required: ['markdown'] },
            presentation: 'raw'
        },
        execution: { kind: 'async_poll', pollIntervalMs: 5_000, maxDurationMs: 120_000 },
        provenance: { providerId: 'fixture.jobs', sourceLocator: 'fixture://maxun/robot-42', discoveredAtMs: NOW },
        ...overrides
    };
}

/** Admit and approve as the host would. The test never approves from the proposal. */
function installApproved(overrides: Partial<CapabilityProposalV1> = {}): CapabilityManifest {
    const installed = admitProposal(asyncProposal(overrides), { nowMs: NOW });
    expect(installed.ok, installed.errors?.join('; ')).toBe(true);
    const manifest = installed.manifest!;
    if (manifest.approval === 'pending') {
        const approved = approveCapability(manifest.id);
        expect(approved.ok).toBe(true);
        return approved.manifest!;
    }
    return manifest;
}

async function waitForPersist(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 30));
}

beforeEach(async () => {
    await __resetVaultConnection();
    clearCapabilities();
    clearExecutionLedger();
    capabilitySecrets.clear();
    capabilitySecrets.set(SLOT, KEY);
});

afterEach(() => {
    unbindAsyncRuntime('maxun');
    capabilitySecrets.clear();
});

describe('async_poll admission', () => {
    it('admits an async proposal with the credential slot bound to the runtime and the profile under the digest', () => {
        const built = manifestFromProposal(asyncProposal(), { nowMs: NOW });
        expect(built.ok, built.errors.join('; ')).toBe(true);
        const manifest = built.manifest!;
        expect(manifest.transport).toEqual({ kind: 'async', runtimeId: 'maxun', operation: 'robot-42' });
        expect(manifest.execution).toEqual({ kind: 'async_poll', pollIntervalMs: 5_000, maxDurationMs: 120_000 });
        expect(manifest.auth.secretRef).toBe(SLOT);
        expect(JSON.stringify(manifest)).not.toContain(KEY);

        const stretched = { ...manifest, execution: { ...manifest.execution!, maxDurationMs: 3_000_000 } };
        expect(validateManifest(stretched).ok).toBe(false);
    });

    it('lands at write and pending unless the host trusts the runtime, and never takes approval from the proposal', () => {
        const untrusted = manifestFromProposal(asyncProposal({ effectHint: 'read' }), { nowMs: NOW }).manifest!;
        expect(untrusted.effect).toBe('write');
        expect(untrusted.approval).toBe('pending');

        const trusted = manifestFromProposal(asyncProposal({ effectHint: 'read' }), {
            nowMs: NOW,
            trustedEffectHints: { asyncRuntimes: ['maxun'] }
        }).manifest!;
        expect(trusted.effect).toBe('read');
        expect(trusted.approval).toBe('auto');

        const destructive = manifestFromProposal(asyncProposal({ effectHint: 'destructive' }), {
            nowMs: NOW,
            trustedEffectHints: { asyncRuntimes: ['maxun'] }
        }).manifest!;
        expect(destructive.effect).toBe('destructive');
        expect(destructive.approval).toBe('pending');

        const forged = manifestFromProposal({ ...asyncProposal(), approval: 'auto' }, { nowMs: NOW });
        expect(forged.ok).toBe(false);
        expect(forged.errors.join(' ')).toMatch(/approval is host-owned/);
    });

    it('refuses an async proposal that names its own endpoint, a mismatched profile, or an untyped result', () => {
        const endpoint = manifestFromProposal({
            ...asyncProposal(),
            transport: { kind: 'async', runtimeId: 'maxun', operation: 'robot-42', baseUrl: 'https://evil.example.test' }
        }, { nowMs: NOW });
        expect(endpoint.ok).toBe(false);
        expect(endpoint.errors.join(' ')).toMatch(/bound by the host runtime/);

        const syncProfile = manifestFromProposal(asyncProposal({ execution: { kind: 'sync' } }), { nowMs: NOW });
        expect(syncProfile.ok).toBe(false);

        const tooFast = manifestFromProposal(
            asyncProposal({ execution: { kind: 'async_poll', pollIntervalMs: 10, maxDurationMs: 60_000 } }),
            { nowMs: NOW }
        );
        expect(tooFast.ok).toBe(false);

        const untyped = manifestFromProposal(
            asyncProposal({ output: { schema: { kind: 'any' }, presentation: 'raw' } }),
            { nowMs: NOW }
        );
        expect(untyped.ok).toBe(false);
        expect(untyped.errors.join(' ')).toMatch(/must be typed/);
    });

    it('refuses an automatic trigger on an async manifest even outside admission', () => {
        const manifest = manifestFromProposal(asyncProposal(), {
            nowMs: NOW,
            trustedEffectHints: { asyncRuntimes: ['maxun'] }
        }).manifest!;
        const { digest: _digest, ...draft } = manifest;
        const onInterval = sealManifest({ ...draft, invocation: 'auto', trigger: { kind: 'interval', everyMs: 60_000 } });
        const result = installProposal(onInterval);
        expect(result.ok).toBe(false);
        expect(result.errors?.join(' ')).toMatch(/async capabilities only run manually/);
    });
});

describe('async_poll execution', () => {
    it('completes a run that takes longer than the 15s request timeout in simulated time', async () => {
        const clock = virtualClock(NOW);
        const fixture = maxunFixture(clock, { finishAfterMs: 42_000 });
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();

        const result = await executeCapability(manifest.id, { url: 'https://example.test/pricing' }, { clock });
        expect(result.ok, result.error?.message).toBe(true);
        expect(result.typed?.value).toEqual({ markdown: '# Pricing\nPro: $12' });
        expect(clock.now() - NOW).toBeGreaterThan(REQUEST_TIMEOUT_MS);
        expect(fixture.calls.start).toBe(1);
        expect(fixture.calls.poll).toBeGreaterThan(1);
        expect(clock.slept.every(ms => ms === 5_000)).toBe(true);
        expect(fixture.calls.headers.every(headers => headers['x-api-key'] === KEY)).toBe(true);

        const record = executionRecord(result.runId!)!;
        expect(record).toMatchObject({
            status: 'succeeded',
            executionProfile: 'async_poll',
            providerId: 'fixture.jobs',
            externalRunId: 'run_1',
            lastObservedStatus: 'succeeded',
            retryPolicy: 'no_redispatch',
            dispatchedAt: NOW
        });
        expect(record.inputDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(record.idempotencyKey).toBe(fixture.calls.idempotencyKeys[0]);
        expect(record.finishedAt).toBe(clock.now());
        expect(record.receipt).toEqual({ ok: true, value: { markdown: '# Pricing\nPro: $12' } });
        expect(JSON.stringify(executionRecords())).not.toContain(KEY);
    });

    it('leaves the per-request timeout at 15s; long work goes through the profile instead', () => {
        const source = readFileSync(path.join(process.cwd(), 'src/core/capabilities/execute.ts'), 'utf8');
        expect(source).toMatch(/const REQUEST_TIMEOUT_MS = 15_000;/);
    });

    it('refuses a write async job until the host approves it, and dispatches nothing before that', async () => {
        const clock = virtualClock(NOW);
        const fixture = maxunFixture(clock);
        bindAsyncRuntime('maxun', fixture.runtime);
        const installed = admitProposal(asyncProposal(), { nowMs: NOW });
        expect(installed.manifest?.approval).toBe('pending');

        const refused = await executeCapability(installed.manifest!.id, {}, { clock });
        expect(refused.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(fixture.calls.start).toBe(0);
        expect(executionRecords()).toHaveLength(0);

        approveCapability(installed.manifest!.id);
        const ran = await executeCapability(installed.manifest!.id, {}, { clock });
        expect(ran.ok).toBe(true);
        expect(fixture.calls.start).toBe(1);
    });

    it('fails deterministically after the slot is revoked and keeps the capability installed', async () => {
        const clock = virtualClock(NOW);
        const fixture = maxunFixture(clock);
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();

        capabilitySecrets.revoke(SLOT);
        const result = await executeCapability(manifest.id, {}, { clock });
        expect(result.error?.code).toBe('AUTH_UNBOUND');
        expect(fixture.calls.start).toBe(0);
        const again = await executeCapability(manifest.id, {}, { clock });
        expect(again.error?.code).toBe('AUTH_UNBOUND');
    });

    it('records a rejected start as failed without an external run id', async () => {
        const clock = virtualClock(NOW);
        capabilitySecrets.set(SLOT, 'wrong-key-value');
        bindAsyncRuntime('maxun', maxunFixture(clock).runtime);
        const manifest = installApproved();

        const result = await executeCapability(manifest.id, {}, { clock });
        expect(result.error?.code).toBe('ASYNC_START_REJECTED');
        expect(executionRecord(result.runId!)).toMatchObject({ status: 'failed' });
        expect(executionRecord(result.runId!)?.externalRunId).toBeUndefined();
    });

    it('marks a write uncertain when the start request fails after dispatch, and does not retry', async () => {
        const clock = virtualClock(NOW);
        const fixture = maxunFixture(clock, { throwOnStart: true });
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();

        const result = await executeCapability(manifest.id, {}, { clock, idempotencyKey: 'scrape-0001' });
        expect(result.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(executionRecord(result.runId!)?.status).toBe('uncertain');

        const replay = await executeCapability(manifest.id, {}, { clock, idempotencyKey: 'scrape-0001' });
        expect(replay.ok).toBe(false);
        expect(fixture.calls.start).toBe(1);
    });

    it('reports an observed failure as failed and a malformed result as a typed-output mismatch', async () => {
        const clock = virtualClock(NOW);
        bindAsyncRuntime('maxun', maxunFixture(clock, { outcome: 'failed' }).runtime);
        const manifest = installApproved();
        const failed = await executeCapability(manifest.id, {}, { clock });
        expect(failed.error?.code).toBe('ASYNC_RUN_FAILED');
        expect(executionRecord(failed.runId!)?.lastObservedStatus).toBe('failed');

        bindAsyncRuntime('maxun', maxunFixture(clock, { outcome: 'malformed' }).runtime);
        const malformed = await executeCapability(manifest.id, {}, { clock });
        expect(malformed.error?.code).toBe('TYPED_OUTPUT_MISMATCH');
    });

    it('stops at the profile deadline: a write becomes uncertain, and nothing is started twice', async () => {
        const clock = virtualClock(NOW);
        const fixture = maxunFixture(clock, { finishAfterMs: 10 * 60_000 });
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();

        const result = await executeCapability(manifest.id, {}, { clock });
        expect(result.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(clock.now() - NOW).toBeGreaterThanOrEqual(120_000);
        expect(clock.now() - NOW).toBeLessThan(120_000 + 5_000 + 1);
        expect(fixture.calls.start).toBe(1);
        expect(executionRecord(result.runId!)).toMatchObject({ status: 'uncertain', externalRunId: 'run_1', lastObservedStatus: 'running' });
    });

    it('fails a trusted read at the deadline instead of calling it uncertain', async () => {
        const clock = virtualClock(NOW);
        bindAsyncRuntime('maxun', maxunFixture(clock, { finishAfterMs: 10 * 60_000 }).runtime);
        const installed = admitProposal(asyncProposal({ effectHint: 'read' }), {
            nowMs: NOW,
            trustedEffectHints: { asyncRuntimes: ['maxun'] }
        });
        const result = await executeCapability(installed.manifest!.id, {}, { clock });
        expect(result.error?.code).toBe('DEADLINE');
        expect(executionRecord(result.runId!)?.status).toBe('failed');
    });

    it('tolerates transient poll failures but gives up observing after repeated ones', async () => {
        const clock = virtualClock(NOW);
        bindAsyncRuntime('maxun', maxunFixture(clock, { pollFailures: 2, finishAfterMs: 20_000 }).runtime);
        const manifest = installApproved();
        const recovered = await executeCapability(manifest.id, {}, { clock });
        expect(recovered.ok).toBe(true);

        const fixture = maxunFixture(clock, { pollFailures: 50 });
        bindAsyncRuntime('maxun', fixture.runtime);
        const lost = await executeCapability(manifest.id, {}, { clock });
        expect(lost.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(fixture.calls.start).toBe(1);
    });

    it('cancel aborts polling and leaves a dispatched run uncertain', async () => {
        const clock = gatedClock(NOW);
        const fixture = maxunFixture(clock);
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();
        const controller = new AbortController();

        const pending = executeCapability(manifest.id, {}, { clock, signal: controller.signal });
        await clock.parked;
        controller.abort();
        const result = await pending;

        expect(result.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(result.error?.message).toMatch(/Do not retry automatically/);
        expect(executionRecord(result.runId!)).toMatchObject({ status: 'uncertain', externalRunId: 'run_1' });
        expect(fixture.calls.start).toBe(1);
    });

    it('closes an uncertain run only when the destination reports a terminal status', async () => {
        const clock = gatedClock(NOW);
        const fixture = maxunFixture(clock, { finishAfterMs: 30_000 });
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();
        const controller = new AbortController();
        const pending = executeCapability(manifest.id, {}, { clock, signal: controller.signal });
        await clock.parked;
        controller.abort();
        const { runId } = await pending;
        clock.open();

        const early = await reconcileAsyncExecution(runId!, {
            clock: { now: () => NOW + 1_000, sleep: async () => { throw abortError(); } }
        });
        expect(early.observed).toBe(false);
        expect(executionRecord(runId!)?.status).toBe('uncertain');

        const later = await reconcileAsyncExecution(runId!, { clock });
        expect(later.observed).toBe(true);
        expect(later.status).toBe('succeeded');
        expect(executionRecord(runId!)?.receipt).toEqual({ ok: true, value: { markdown: '# Pricing\nPro: $12' } });
        expect(fixture.calls.start).toBe(1);
    });
});

describe('restart recovery', () => {
    it('reads the persisted ledger after a reload and observes the external run without starting it again', async () => {
        const clock = gatedClock(NOW);
        let destinationTime: AsyncClock = clock;
        const before = maxunFixture({ now: () => destinationTime.now(), sleep: async () => {} }, { finishAfterMs: 30_000 });
        bindAsyncRuntime('maxun', before.runtime);
        const manifest = installApproved();
        const controller = new AbortController();
        const pending = executeCapability(manifest.id, {}, { clock, signal: controller.signal });
        await clock.parked;
        await waitForPersist();

        const persisted = await vaultStorage.getItem('omni-capability-executions');
        expect(persisted).toBeTruthy();
        expect(persisted).not.toContain(KEY);
        const stored = JSON.parse(persisted as string) as { state: { records: Array<Record<string, unknown>> } };
        expect(stored.state.records[0]).toMatchObject({
            status: 'running',
            executionProfile: 'async_poll',
            externalRunId: 'run_1',
            lastObservedStatus: 'running',
            providerId: 'fixture.jobs'
        });

        // The old process goes away mid-poll. Its in-memory state is gone; the vault copy is not.
        controller.abort();
        await pending;
        clearExecutionLedger();
        await vaultStorage.setItem('omni-capability-executions', persisted as string);
        await useExecutionLedger.persist.rehydrate();
        expect(executionRecords()[0]).toMatchObject({ status: 'running', externalRunId: 'run_1' });

        let starts = 0;
        const after: AsyncJobRuntime = {
            start: async () => { starts += 1; return { externalRunId: 'run_2' }; },
            poll: (operation, runId, call) => before.runtime.poll(operation, runId, call)
        };
        bindAsyncRuntime('maxun', after);
        const resumed = virtualClock(NOW + 10_000);
        destinationTime = resumed;
        const reports = await recoverAsyncExecutions({ clock: resumed });

        expect(reports).toHaveLength(1);
        expect(reports[0]).toMatchObject({ observed: true, status: 'succeeded' });
        expect(starts).toBe(0);
        expect(before.calls.start).toBe(1);
        expect(executionRecords()[0]).toMatchObject({ status: 'succeeded', externalRunId: 'run_1' });
    });

    it('fails a run that was admitted and never dispatched, and leaves a run it cannot observe open', async () => {
        const clock = virtualClock(NOW);
        const fixture = maxunFixture(clock);
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();
        const base = {
            capabilityId: manifest.id,
            manifestDigest: manifest.digest,
            effect: manifest.effect,
            inputDigest: 'a'.repeat(64),
            startedAt: NOW,
            deadlineAt: NOW + 135_000,
            executionProfile: 'async_poll' as const,
            retryPolicy: 'no_redispatch' as const
        };
        useExecutionLedger.setState({
            records: [
                { ...base, runId: 'never', idempotencyKey: 'never-dispatched', status: 'admitted' },
                { ...base, runId: 'orphan', idempotencyKey: 'orphan-run-0001', status: 'running', dispatchedAt: NOW, externalRunId: 'run_404' }
            ]
        });
        capabilitySecrets.revoke(SLOT);

        const reports = await recoverAsyncExecutions({ clock });
        expect(reports.find(r => r.runId === 'never')).toMatchObject({ status: 'failed', reason: 'never dispatched' });
        expect(reports.find(r => r.runId === 'orphan')).toMatchObject({ status: 'running', observed: false });
        expect(fixture.calls.start).toBe(0);
        expect(fixture.calls.poll).toBe(0);
    });

    it('does not observe a run whose capability was denied or replaced', async () => {
        const clock = gatedClock(NOW);
        const fixture = maxunFixture(clock);
        bindAsyncRuntime('maxun', fixture.runtime);
        const manifest = installApproved();
        const controller = new AbortController();
        const pending = executeCapability(manifest.id, {}, { clock, signal: controller.signal });
        await clock.parked;
        controller.abort();
        const { runId } = await pending;
        clock.open();

        useExecutionLedger.setState({
            records: executionRecords().map(record => (record.runId === runId ? { ...record, manifestDigest: 'f'.repeat(64) } : record))
        });
        const report = await reconcileAsyncExecution(runId!, { clock });
        expect(report).toMatchObject({ observed: false, status: 'uncertain' });
        expect(report.reason).toMatch(/not installed/);
    });
});

describe('server ledger', () => {
    it('keeps the async fields, sets the external run id once, and leaves sync rows sync', async () => {
        const ledger = memoryLedger();
        const row = {
            runId: 'srv-1',
            capabilityId: 'cap.async',
            manifestDigest: 'b'.repeat(64),
            effect: 'write',
            inputDigest: 'c'.repeat(64),
            idempotencyKey: 'server-key-001',
            status: 'admitted' as const,
            executionProfile: 'async_poll' as const,
            providerId: 'fixture.jobs'
        };
        expect((await ledger.admit(row)).kind).toBe('new');
        await ledger.markDispatched('srv-1');
        await ledger.recordExternalRun('srv-1', 'run_1');
        await ledger.recordExternalRun('srv-1', 'run_swapped');
        await ledger.observe('srv-1', 'running');
        expect(await ledger.find('srv-1')).toMatchObject({
            status: 'running',
            executionProfile: 'async_poll',
            providerId: 'fixture.jobs',
            externalRunId: 'run_1',
            lastObservedStatus: 'running'
        });

        await ledger.admit({ ...row, runId: 'srv-2', idempotencyKey: 'server-key-002', executionProfile: undefined });
        await ledger.recordExternalRun('srv-2', 'run_x');
        const sync = await ledger.find('srv-2');
        expect(sync?.executionProfile).toBe('sync');
        expect(sync?.externalRunId).toBeUndefined();
    });
});
