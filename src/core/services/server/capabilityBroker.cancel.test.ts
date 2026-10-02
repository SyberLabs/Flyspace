import { describe, it, expect, afterEach } from 'vitest';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { sealManifest } from '@/core/capabilities/manifest';
import { createBrokerRateLimiter, handleCapabilityBroker } from './capabilityBroker';
import { memoryLedger, type ServerLedger } from './capability.ledger';

function brokerManifest() {
    const compiled = compileOpenApi({
        openapi: '3.0.3',
        info: { title: 'Board', version: '1' },
        servers: [{ url: 'https://board.example.test' }],
        paths: {
            '/items': {
                get: {
                    operationId: 'list',
                    responses: { '200': { description: 'items', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } }
                }
            }
        }
    }).manifests[0];
    if (compiled.transport.kind !== 'http') throw new Error('expected http');
    return sealManifest({ ...compiled, transport: { ...compiled.transport, access: 'server_broker' } });
}

// Plain functions, not vi.fn: a spy observes the promises it returns, which
// would hide exactly the unobserved rejection these tests look for.

/** Like pinnedFetch: a call made with an aborted signal rejects. */
function abortingFetch() {
    const fetch = async (request: { signal?: AbortSignal }) => {
        fetch.calls += 1;
        if (request.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
        return { status: 200, headers: {}, text: '[]' };
    };
    fetch.calls = 0;
    return fetch;
}

function failingLookup() {
    const resolve = async (_hostname: string): Promise<string[]> => {
        resolve.calls += 1;
        throw new Error('lookup failed');
    };
    resolve.calls = 0;
    return resolve;
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

async function settleMicrotasksAndTimers() {
    await new Promise(resolve => setTimeout(resolve, 20));
}

afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    unhandled.length = 0;
});

describe('broker cancellation', () => {
    it('does not start the upstream call when the signal aborts while the ledger admission is pending', async () => {
        process.on('unhandledRejection', onUnhandled);
        const controller = new AbortController();
        const inner = memoryLedger();
        let releaseAdmit!: () => void;
        const gate = new Promise<void>(resolve => { releaseAdmit = resolve; });
        const finished: unknown[][] = [];
        const ledger: ServerLedger = {
            ...inner,
            admit: async (row) => {
                await gate;
                return inner.admit(row);
            },
            finish: async (...args) => {
                finished.push(args);
                return inner.finish(...args);
            }
        };
        const fetch = abortingFetch();
        const pending = handleCapabilityBroker({ manifest: brokerManifest(), input: {}, idempotencyKey: 'broker-key-cancel-1' }, {
            ledger,
            resolve: async () => ['1.1.1.1'],
            fetch,
            signal: controller.signal,
            limiter: createBrokerRateLimiter()
        });
        await settleMicrotasksAndTimers();
        controller.abort();
        releaseAdmit();
        const result = await pending;
        await settleMicrotasksAndTimers();

        expect(unhandled).toEqual([]);
        expect(result.status).toBe(504);
        expect(fetch.calls).toBe(0);
        // Nothing was sent: the row is canceled and carries no error text.
        expect(finished).toEqual([[expect.any(String), 'canceled']]);
    });

    it('does not start a name lookup when the signal is already aborted', async () => {
        process.on('unhandledRejection', onUnhandled);
        const resolve = failingLookup();
        const fetch = abortingFetch();
        const result = await handleCapabilityBroker({ manifest: brokerManifest(), input: {}, idempotencyKey: 'broker-key-cancel-2' }, {
            ledger: memoryLedger(),
            resolve,
            fetch,
            signal: AbortSignal.abort(),
            limiter: createBrokerRateLimiter()
        });
        await settleMicrotasksAndTimers();

        expect(unhandled).toEqual([]);
        expect(result.status).toBe(504);
        expect(resolve.calls).toBe(0);
        expect(fetch.calls).toBe(0);
    });

    it('observes an upstream call that rejects after the deadline already answered', async () => {
        process.on('unhandledRejection', onUnhandled);
        let calls = 0;
        const lateFailure = (_request: unknown) => {
            calls += 1;
            return new Promise<never>((_, reject) => setTimeout(() => reject(new Error('socket closed')), 30));
        };
        const result = await handleCapabilityBroker({ manifest: brokerManifest(), input: {}, idempotencyKey: 'broker-key-cancel-3' }, {
            ledger: memoryLedger(),
            resolve: async () => ['1.1.1.1'],
            fetch: lateFailure,
            signal: AbortSignal.timeout(5),
            limiter: createBrokerRateLimiter()
        });
        await new Promise(resolve => setTimeout(resolve, 60));

        expect(unhandled).toEqual([]);
        expect(result.status).toBe(504);
        expect(calls).toBe(1);
    });
});
