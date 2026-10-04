import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Every string the engine hashes is recorded, so a test can compare the
// hashed form of a run with what the transport received, byte for byte.
const hashed = vi.hoisted(() => [] as string[]);
vi.mock('./hash', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./hash')>();
    return {
        ...actual,
        sha256: (message: string) => {
            hashed.push(message);
            return actual.sha256(message);
        }
    };
});

import { compileOpenApi } from './openapi';
import { canonicalCapabilityId } from './identity';
import { sealManifest, type CapabilityInput } from './manifest';
import { admitProposal } from './admission';
import { approveCapability, clearCapabilities, installProposal } from './registry';
import {
    bindLocalHandler,
    bindMcpTransport,
    executeCapability,
    previewCapabilityRun,
    unbindLocalHandler,
    unbindMcpTransport
} from './execute';
import { bindAsyncRuntime, unbindAsyncRuntime, type AsyncClock } from './asyncRuntime';
import { clearExecutionLedger } from './executionLedger';
import { capabilitySecrets } from './secrets';
import type { CapabilityProposalV1 } from './provider';
import type { CapabilityResult } from './project';

const NOW = 1_790_000_000_000;
const PAYLOAD: CapabilityInput = { name: 'payload', in: 'argument', required: true, schema: { kind: 'object' } };

/** One write capability on one transport, and what its transport received. */
interface Fixture {
    id: string;
    /** The arguments object (or, for http, the body text) each dispatch received. */
    received: unknown[];
    /** The hashed form that must equal what was received. */
    hashedForm(digestInput: Record<string, unknown>): unknown;
    /** What the transport received, in the same form. */
    sentForm(received: unknown): unknown;
    clock?: AsyncClock;
    cleanup(): void;
}

function clock(): AsyncClock {
    let now = NOW;
    return {
        now: () => now,
        async sleep(ms) {
            now += ms;
            await Promise.resolve();
        }
    };
}

function httpFixture(): Fixture {
    const spec = {
        openapi: '3.0.3',
        info: { title: 'Ledger', version: '1' },
        servers: [{ url: 'https://ledger.example.test/v1' }],
        paths: {
            '/notes': {
                post: {
                    operationId: 'note',
                    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
                    responses: { '204': { description: 'stored' } }
                }
            }
        }
    };
    const compiled = compileOpenApi(spec).manifests[0];
    const manifest = sealManifest({ ...compiled, inputs: [{ ...PAYLOAD, in: 'body' }] });
    expect(installProposal(manifest).ok).toBe(true);
    approveCapability(manifest.id);
    const received: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        received.push(init?.body);
        return new Response(null, { status: 204 });
    }));
    return {
        id: manifest.id,
        received,
        hashedForm: digestInput => digestInput.body,
        sentForm: body => body,
        cleanup: () => vi.unstubAllGlobals()
    };
}

function mcpFixture(): Fixture {
    const proposal: CapabilityProposalV1 = {
        version: 1,
        provider: { id: 'fixture.mcp', kind: 'mcp' },
        externalIdentity: { operationId: 'post', sourceLocator: 'fixture://mcp/board' },
        title: 'Post',
        auth: { kind: 'none' },
        transport: { kind: 'mcp', serverId: 'board', toolName: 'post' },
        inputs: [PAYLOAD],
        output: { schema: { kind: 'null' }, presentation: 'raw' },
        execution: { kind: 'sync' },
        provenance: { providerId: 'fixture.mcp', sourceLocator: 'fixture://mcp/board', discoveredAtMs: NOW }
    };
    const installed = admitProposal(proposal, { nowMs: NOW });
    expect(installed.ok, installed.errors.join('; ')).toBe(true);
    const manifest = approveCapability(installed.manifest!.id).manifest!;
    expect(manifest.effect).toBe('write');
    const received: unknown[] = [];
    bindMcpTransport('board', { call: async (_server, _tool, args) => { received.push(args); return null; } });
    return {
        id: manifest.id,
        received,
        hashedForm: digestInput => digestInput.argumentsJson,
        sentForm: args => JSON.stringify(args),
        cleanup: () => unbindMcpTransport('board')
    };
}

function asyncFixture(): Fixture {
    const proposal: CapabilityProposalV1 = {
        version: 1,
        provider: { id: 'fixture.jobs', kind: 'manual' },
        externalIdentity: { operationId: 'job-7', sourceLocator: 'fixture://jobs/job-7' },
        title: 'Submit job',
        auth: { kind: 'none' },
        transport: { kind: 'async', runtimeId: 'jobs', operation: 'job-7' },
        inputs: [PAYLOAD],
        output: { schema: { kind: 'object' }, presentation: 'raw' },
        execution: { kind: 'async_poll', pollIntervalMs: 5_000, maxDurationMs: 120_000 },
        provenance: { providerId: 'fixture.jobs', sourceLocator: 'fixture://jobs/job-7', discoveredAtMs: NOW }
    };
    const installed = admitProposal(proposal, { nowMs: NOW });
    expect(installed.ok, installed.errors.join('; ')).toBe(true);
    const manifest = approveCapability(installed.manifest!.id).manifest!;
    expect(manifest.effect).toBe('write');
    const received: unknown[] = [];
    bindAsyncRuntime('jobs', {
        async start(_operation, args) {
            received.push(args);
            return { externalRunId: `ext_${received.length}` };
        },
        async poll() {
            return { status: 'succeeded', value: {} };
        }
    });
    return {
        id: manifest.id,
        received,
        hashedForm: digestInput => digestInput.argumentsJson,
        sentForm: args => JSON.stringify(args),
        clock: clock(),
        cleanup: () => unbindAsyncRuntime('jobs')
    };
}

function localFixture(): Fixture {
    const transport = { kind: 'local' as const, handler: 'fixture.write' };
    const manifest = sealManifest({
        version: 1,
        id: canonicalCapabilityId(transport),
        title: 'Local write',
        source: { kind: 'bring', locator: 'fixture', operationId: 'write' },
        effect: 'write',
        effectSource: 'declared',
        approval: 'pending',
        invocation: 'manual',
        auth: { kind: 'none' },
        transport,
        inputs: [PAYLOAD],
        output: { schema: { kind: 'null' }, presentation: 'raw' }
    });
    const installed = installProposal(manifest);
    expect(installed.ok, installed.errors?.join('; ')).toBe(true);
    approveCapability(manifest.id);
    const received: unknown[] = [];
    bindLocalHandler('fixture.write', async (args) => { received.push(args); return null; });
    return {
        id: manifest.id,
        received,
        hashedForm: digestInput => digestInput.argumentsJson,
        sentForm: args => JSON.stringify(args),
        cleanup: () => unbindLocalHandler('fixture.write')
    };
}

const TRANSPORTS: Array<[string, () => Fixture]> = [
    ['http', httpFixture],
    ['mcp', mcpFixture],
    ['async', asyncFixture],
    ['local', localFixture]
];

class Point {
    constructor(public x: number) {}
}

function sparse(): unknown[] {
    const list = [1, 2, 3];
    delete list[1];
    return list;
}

const symbolKey = Symbol('hidden');

/** Values a JSON transport cannot carry, or would carry as something else. */
const NON_JSON: Array<[string, () => unknown]> = [
    ['an undefined property', () => ({ hidden: undefined })],
    ['an undefined array element', () => ({ list: [1, undefined] })],
    ['NaN', () => ({ n: Number.NaN })],
    ['Infinity', () => ({ n: Number.POSITIVE_INFINITY })],
    ['-Infinity', () => ({ n: Number.NEGATIVE_INFINITY })],
    ['a BigInt', () => ({ n: BigInt(1) })],
    ['a function', () => ({ f: () => 1 })],
    ['a symbol value', () => ({ s: Symbol('s') })],
    ['a symbol key', () => ({ [symbolKey]: 1, shown: 1 })],
    ['a Date', () => ({ when: new Date(NOW) })],
    ['a Map', () => ({ m: new Map([['a', 1]]) })],
    ['a Set', () => ({ s: new Set([1]) })],
    ['a class instance', () => ({ p: new Point(1) })],
    ['an object with toJSON', () => ({ o: { toJSON: () => 'other' } })],
    ['a sparse array', () => ({ list: sparse() })],
    ['an array with a -1 key', () => ({ list: Object.assign([1], { '-1': undefined }) })],
    ['an array with a 0.5 key', () => ({ list: Object.assign([1], { '0.5': 2 }) })],
    ['an array with a NaN key', () => ({ list: Object.assign([1], { NaN: 2 }) })],
    ['an array with a -0 key', () => ({ list: Object.assign([1], { '-0': 2 }) })],
    ['an accessor property', () => ({ get live() { return 1; } })],
    ['a non-enumerable property', () => Object.defineProperty({ shown: 1 }, 'unseen', { value: 2, enumerable: false })],
    ['a self reference', () => { const o: Record<string, unknown> = {}; o.self = o; return o; }]
];

function digestInputs(): Array<Record<string, unknown>> {
    return hashed
        .filter(message => message.includes('"manifestDigest"'))
        .map(message => JSON.parse(message) as Record<string, unknown>);
}

beforeEach(() => {
    clearCapabilities();
    clearExecutionLedger();
    capabilitySecrets.clear();
    hashed.length = 0;
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe.each(TRANSPORTS)('%s write: the confirmed arguments are the sent arguments', (_name, make) => {
    let fixture: Fixture;
    beforeEach(() => { fixture = make(); });
    afterEach(() => fixture.cleanup());

    async function confirmAndRun(input: Record<string, unknown>, confirmedInput = input): Promise<CapabilityResult> {
        const preview = previewCapabilityRun(fixture.id, confirmedInput);
        if (!preview.ok) throw new Error(preview.result.error?.message);
        return executeCapability(fixture.id, input, {
            confirmedRun: preview.preview.digest,
            ...(fixture.clock ? { clock: fixture.clock } : {})
        });
    }

    it('refuses an undefined property instead of sharing a confirmation with an object without it', async () => {
        expect(previewCapabilityRun(fixture.id, { payload: {} }).ok).toBe(true);
        const preview = previewCapabilityRun(fixture.id, { payload: { hidden: undefined } });
        expect(preview.ok).toBe(false);
        if (!preview.ok) expect(preview.result.error?.code).toBe('INPUT_INVALID');
        const result = await executeCapability(fixture.id, { payload: { hidden: undefined } });
        expect(result.error?.code).toBe('INPUT_INVALID');
        expect(fixture.received).toHaveLength(0);
    });

    it.each(NON_JSON)('refuses %s before any preview is built', async (_label, value) => {
        const preview = previewCapabilityRun(fixture.id, { payload: value() });
        expect(preview.ok).toBe(false);
        if (!preview.ok) expect(preview.result.error?.code).toBe('INPUT_INVALID');
        const result = await executeCapability(fixture.id, { payload: value() });
        expect(result.error?.code).toBe('INPUT_INVALID');
        expect(fixture.received).toHaveLength(0);
    });

    it('a wire that changes after the preview cannot reuse its confirmation', async () => {
        const confirmed = { payload: { a: 1 } };
        const added = await confirmAndRun({ payload: { a: 1, b: 2 } }, confirmed);
        expect(added.error?.code).toBe('CONFIRMATION_REQUIRED');
        const hidden = await confirmAndRun({ payload: { a: 1, hidden: undefined } }, confirmed);
        expect(hidden.ok).toBe(false);
        const reordered = await confirmAndRun({ payload: { b: 2, a: 1 } }, { payload: { a: 1, b: 2 } });
        expect(reordered.error?.code).toBe('CONFIRMATION_REQUIRED');
        expect(fixture.received).toHaveLength(0);
    });

    it('normalises -0 to 0 in both the hashed and the sent form', async () => {
        const negative = previewCapabilityRun(fixture.id, { payload: { n: -0 } });
        const positive = previewCapabilityRun(fixture.id, { payload: { n: 0 } });
        if (!negative.ok || !positive.ok) throw new Error('preview failed');
        expect(negative.preview.digest).toBe(positive.preview.digest);
        expect(Object.is((negative.preview.arguments.payload as { n: number }).n, 0)).toBe(true);
    });

    it('sends the exact bytes it hashed, from a frozen copy of the input', async () => {
        const input = { payload: { text: 'deploy', nested: { list: [1, 'two', null, { deep: true }] } } };
        hashed.length = 0;
        const result = await confirmAndRun(input);
        expect(result.ok, result.error?.message).toBe(true);
        expect(fixture.received).toHaveLength(1);
        const sent = fixture.received[0];
        // The preview's digest and the dispatch's digest each hashed one form; the
        // last one is the run that was sent. Byte equality, not deep equality.
        const runDigest = digestInputs().at(-1)!;
        expect(fixture.hashedForm(runDigest)).toBe(fixture.sentForm(sent));
        if (typeof sent === 'object' && sent !== null) {
            expect(sent).not.toBe(input);
            const payload = (sent as Record<string, unknown>).payload as Record<string, unknown>;
            expect(payload).not.toBe(input.payload);
            expect(Object.isFrozen(sent)).toBe(true);
            expect(Object.isFrozen(payload)).toBe(true);
            expect(Object.isFrozen((payload.nested as Record<string, unknown>).list)).toBe(true);
        }
        // Changing the caller's object afterwards changes nothing that was hashed or sent.
        input.payload.text = 'changed';
        expect(fixture.sentForm(sent)).toBe(fixture.hashedForm(runDigest));
    });
});

describe('the run ledger keys on the dispatched arguments', () => {
    it('a different argument under the same idempotency key conflicts instead of replaying', async () => {
        const fixture = mcpFixture();
        try {
            const run = async (payload: Record<string, unknown>) => {
                const preview = previewCapabilityRun(fixture.id, { payload });
                if (!preview.ok) throw new Error(preview.result.error?.message);
                return executeCapability(fixture.id, { payload }, { confirmedRun: preview.preview.digest, idempotencyKey: 'same-key-0001' });
            };
            expect((await run({ a: 1 })).ok).toBe(true);
            expect((await run({ a: 1, b: 2 })).error?.code).toBe('IDEMPOTENCY_CONFLICT');
            expect(fixture.received).toHaveLength(1);
        } finally {
            fixture.cleanup();
        }
    });

    it('arguments that serialize differently conflict even when a canonical form would match', async () => {
        const fixture = mcpFixture();
        try {
            const run = async (payload: Record<string, unknown>) => {
                const preview = previewCapabilityRun(fixture.id, { payload });
                if (!preview.ok) throw new Error(preview.result.error?.message);
                return executeCapability(fixture.id, { payload }, { confirmedRun: preview.preview.digest, idempotencyKey: 'same-key-0002' });
            };
            expect((await run({ a: 1, b: 2 })).ok).toBe(true);
            expect((await run({ b: 2, a: 1 })).error?.code).toBe('IDEMPOTENCY_CONFLICT');
            expect((await run({ a: 1, b: 2 })).ok).toBe(true);
            expect(fixture.received).toHaveLength(1);
        } finally {
            fixture.cleanup();
        }
    });
});
