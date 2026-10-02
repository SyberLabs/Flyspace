import { describe, it, expect, beforeEach } from 'vitest';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { sealManifest } from '@/core/capabilities/manifest';
import { canonicalCapabilityId } from '@/core/capabilities/identity';
import { admitBrokerCaller, createBrokerRateLimiter, handleCapabilityBroker, type BrokerDeps, type BrokerRateLimiter } from './capabilityBroker';
import { memoryLedger } from './capability.ledger';
import type { PinnedRequest } from './pinnedFetch';

function listManifest(access: 'browser_direct' | 'server_broker' = 'server_broker', baseUrl = 'https://board.example.test') {
    const compiled = compileOpenApi({
        openapi: '3.0.3',
        info: { title: 'Board', version: '1' },
        servers: [{ url: 'https://board.example.test' }],
        paths: {
            '/items': {
                get: {
                    operationId: 'list',
                    responses: {
                        '200': {
                            description: 'items',
                            content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } }
                        }
                    }
                }
            }
        }
    }).manifests[0];
    if (compiled.transport.kind !== 'http') throw new Error('expected http');
    // Sealed directly, not compiled, so a base URL the compiler would refuse
    // still reaches the broker as a client could send it.
    const transport = { ...compiled.transport, access, baseUrl };
    return sealManifest({ ...compiled, id: canonicalCapabilityId(transport), transport });
}

// Each test gets its own limiter. The budget is per caller, so tests no
// longer stay apart by using different manifests.
let limiter: BrokerRateLimiter;
beforeEach(() => {
    limiter = createBrokerRateLimiter();
});

function broker(body: unknown, deps: BrokerDeps) {
    return handleCapabilityBroker(body, { limiter, ...deps });
}

describe('capability broker', () => {
    it('fetches only after the resolved address is public', async () => {
        const seen: PinnedRequest[] = [];
        const result = await broker({
            manifest: listManifest(),
            input: {},
            idempotencyKey: 'broker-key-1'
        }, {
            ledger: memoryLedger(),
            resolve: async () => ['1.1.1.1'],
            fetch: async (request) => {
                seen.push(request);
                return { status: 200, headers: { 'content-type': 'application/json' }, text: '["ok"]' };
            }
        });
        expect(result.status).toBe(200);
        expect(seen[0]?.address).toBe('1.1.1.1');
        expect(seen[0]?.url.hostname).toBe('board.example.test');
        expect((result.body as { value: unknown }).value).toEqual(['ok']);
    });

    it('does not open a socket to a private address', async () => {
        let called = false;
        const result = await broker({
            manifest: listManifest(),
            input: {},
            idempotencyKey: 'broker-key-2'
        }, {
            ledger: memoryLedger(),
            resolve: async () => ['169.254.169.254'],
            fetch: async () => {
                called = true;
                return { status: 200, headers: {}, text: '[]' };
            }
        });
        expect(result.status).toBe(403);
        expect(called).toBe(false);
    });

    it('replays an idempotent key without fetching again', async () => {
        const ledger = memoryLedger();
        const deps = {
            ledger,
            resolve: async () => ['1.1.1.1'],
            fetch: async () => ({ status: 200, headers: {}, text: '["ok"]' })
        };
        let calls = 0;
        const fetch = async () => {
            calls += 1;
            return { status: 200, headers: {}, text: '["ok"]' };
        };
        const body = { manifest: listManifest(), input: {}, idempotencyKey: 'broker-key-3' };
        await broker(body, { ...deps, fetch });
        const replay = await broker(body, { ...deps, fetch });
        expect(calls).toBe(1);
        expect((replay.body as { replayed?: boolean }).replayed).toBe(true);
    });

    it('refuses a write even if the manifest claims the broker', async () => {
        const compiled = compileOpenApi({
            openapi: '3.0.3',
            info: { title: 'Pay', version: '1' },
            servers: [{ url: 'https://pay.example.test' }],
            paths: {
                '/payments': {
                    post: {
                        operationId: 'pay',
                        responses: { '204': { description: 'accepted' } }
                    }
                }
            }
        }).manifests[0];
        const forged = {
            ...compiled,
            effect: 'read',
            approval: 'auto',
            transport: { ...compiled.transport, access: 'server_broker', method: 'POST' }
        };
        const result = await broker({
            manifest: forged,
            input: {},
            idempotencyKey: 'broker-key-4'
        }, {
            ledger: memoryLedger(),
            resolve: async () => ['1.1.1.1'],
            fetch: async () => ({ status: 200, headers: {}, text: 'null' })
        });
        expect(result.status).toBe(400);
    });

    it.each([
        '[::ffff:127.0.0.1]',
        '[::ffff:a9fe:a9fe]',
        '[::ffff:0:7f00:1]',
        '[::7f00:1]',
        '[64:ff9b::a9fe:a9fe]',
        '[2002:7f00:1::]',
        '[fec0::1]'
    ])('never dials the IPv6 literal %s', async (literal) => {
        let fetched = false;
        let resolved = false;
        const result = await broker({
            manifest: listManifest('server_broker', `https://${literal}`),
            input: {},
            idempotencyKey: 'broker-key-literal'
        }, {
            ledger: memoryLedger(),
            resolve: async () => {
                resolved = true;
                return ['1.1.1.1'];
            },
            fetch: async () => {
                fetched = true;
                return { status: 200, headers: {}, text: '[]' };
            }
        });
        expect([400, 403]).toContain(result.status);
        expect(fetched).toBe(false);
        expect(resolved).toBe(false);
    });

    it('returns a generic error instead of the transport error text', async () => {
        const ledger = memoryLedger();
        const result = await broker({
            manifest: listManifest(),
            input: {},
            idempotencyKey: 'broker-key-generic'
        }, {
            ledger,
            resolve: async () => ['1.1.1.1'],
            fetch: async () => {
                throw new Error('connect ECONNREFUSED 10.0.0.7:6379');
            }
        });
        expect(result.status).toBe(502);
        const text = JSON.stringify(result.body);
        expect(text).not.toContain('ECONNREFUSED');
        expect(text).not.toContain('10.0.0.7');
        const runId = (result.body as { runId: string }).runId;
        expect((await ledger.find(runId))?.error).toBe('UPSTREAM_ERROR');
    });

    it('answers 504 within the deadline when the upstream never responds', async () => {
        const ledger = memoryLedger();
        let received: AbortSignal | undefined;
        const started = Date.now();
        const result = await broker({
            manifest: listManifest(),
            input: {},
            idempotencyKey: 'broker-key-deadline'
        }, {
            ledger,
            resolve: async () => ['1.1.1.1'],
            fetch: (request) => {
                received = request.signal;
                return new Promise(() => undefined);
            },
            signal: AbortSignal.timeout(50)
        });
        expect(result.status).toBe(504);
        expect(Date.now() - started).toBeLessThan(2_000);
        expect(received?.aborted).toBe(true);
        const runId = (result.body as { runId: string }).runId;
        expect((await ledger.find(runId))?.error).toBe('DEADLINE');
    });

    it('answers 504 when name resolution outlives the deadline', async () => {
        let fetched = false;
        const result = await broker({
            manifest: listManifest(),
            input: {},
            idempotencyKey: 'broker-key-dns-deadline'
        }, {
            ledger: memoryLedger(),
            resolve: () => new Promise(() => undefined),
            fetch: async () => {
                fetched = true;
                return { status: 200, headers: {}, text: '[]' };
            },
            signal: AbortSignal.timeout(50)
        });
        expect(result.status).toBe(504);
        expect(fetched).toBe(false);
    });
});

describe('broker manifest bounds', () => {
    it('refuses a manifest with more inputs than the cap before resolving or fetching', async () => {
        const base = listManifest();
        const inputs = Array.from({ length: 65 }, (_, i) => ({
            name: `q${i}`, in: 'query' as const, required: false, schema: { kind: 'string' as const }
        }));
        const { digest: _digest, ...draft } = base;
        const wide = sealManifest({ ...draft, inputs });
        let touched = false;
        const result = await broker({ manifest: wide, input: {}, idempotencyKey: 'broker-key-wide' }, {
            ledger: memoryLedger(),
            resolve: async () => { touched = true; return ['1.1.1.1']; },
            fetch: async () => { touched = true; return { status: 200, headers: {}, text: '[]' }; }
        });
        expect(result.status).toBe(400);
        expect(JSON.stringify(result.body)).toContain('inputs exceeds 64');
        expect(touched).toBe(false);
    });
});

describe('broker path arguments', () => {
    it('refuses a dot-segment path value and never resolves or fetches', async () => {
        const compiled = compileOpenApi({
            openapi: '3.0.3',
            info: { title: 'Board', version: '1' },
            servers: [{ url: 'https://board.example.test/v1' }],
            paths: {
                '/items/{id}': {
                    get: {
                        operationId: 'item',
                        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                        responses: { '200': { description: 'item', content: { 'application/json': { schema: { type: 'object' } } } } }
                    }
                }
            }
        }).manifests[0];
        if (compiled.transport.kind !== 'http') throw new Error('expected http');
        const manifest = sealManifest({ ...compiled, transport: { ...compiled.transport, access: 'server_broker' } });
        let touched = false;
        const result = await broker({ manifest, input: { id: '..' }, idempotencyKey: 'broker-key-dots' }, {
            ledger: memoryLedger(),
            resolve: async () => { touched = true; return ['1.1.1.1']; },
            fetch: async () => { touched = true; return { status: 200, headers: {}, text: '{}' }; }
        });
        expect(result.status).toBe(400);
        expect(touched).toBe(false);
    });
});

describe('broker idempotency', () => {
    function searchManifest() {
        const compiled = compileOpenApi({
            openapi: '3.0.3',
            info: { title: 'Board', version: '1' },
            servers: [{ url: 'https://board.example.test/v1' }],
            components: { securitySchemes: { Key: { type: 'apiKey', in: 'query', name: 'key' } } },
            security: [{ Key: [] }],
            paths: {
                '/search': {
                    get: {
                        operationId: 'search',
                        parameters: [{ name: 'q', in: 'query', required: false, schema: { type: 'string' } }],
                        responses: { '200': { description: 'hits', content: { 'application/json': { schema: { type: 'object' } } } } }
                    }
                }
            }
        }).manifests[0];
        if (compiled.transport.kind !== 'http') throw new Error('expected http');
        return sealManifest({ ...compiled, transport: { ...compiled.transport, access: 'server_broker' } });
    }

    function deps(urls: string[]): BrokerDeps {
        return {
            ledger: memoryLedger(),
            resolve: async () => ['1.1.1.1'],
            fetch: async (request) => {
                urls.push(request.url.toString());
                return { status: 200, headers: {}, text: '{}' };
            }
        };
    }

    it('keys a run on the request it sends: a different query under the same key conflicts', async () => {
        const urls: string[] = [];
        const shared = deps(urls);
        const manifest = searchManifest();
        const first = await broker({ manifest, input: { q: { a: 1, b: 2 } }, idempotencyKey: 'broker-key-order' }, shared);
        expect(first.status).toBe(200);
        // Same members, different order: a different query string would be sent.
        const second = await broker({ manifest, input: { q: { b: 2, a: 1 } }, idempotencyKey: 'broker-key-order' }, shared);
        expect(second.status).toBe(409);
        expect(urls).toHaveLength(1);
    });

    it('the run key carries nothing derived from the credential', async () => {
        const urls: string[] = [];
        const ledger = memoryLedger();
        const shared = { ...deps(urls), ledger };
        const manifest = searchManifest();
        const body = { manifest, input: { q: 'x' }, idempotencyKey: 'broker-key-cred' };
        expect((await broker({ ...body, secret: 'fixture-key-one' }, shared)).status).toBe(200);
        // The same request with another credential replays rather than conflicting.
        const again = await broker({ ...body, secret: 'fixture-key-two' }, shared);
        expect(again.status).toBe(200);
        expect((again.body as { replayed?: boolean }).replayed).toBe(true);
        expect(urls).toHaveLength(1);
    });
});

describe('memory ledger', () => {
    it('evicts settled rows first once it is full', async () => {
        const ledger = memoryLedger(2);
        const row = (n: number) => ({
            runId: `run_${n}`, capabilityId: 'cap_x', manifestDigest: 'd', effect: 'read',
            inputDigest: 'i', idempotencyKey: `key-${n}`, status: 'admitted' as const
        });
        await ledger.admit(row(1));
        await ledger.admit(row(2));
        await ledger.finish('run_2', 'succeeded');
        await ledger.admit(row(3));
        expect(await ledger.find('run_1')).toBeDefined();
        expect(await ledger.find('run_2')).toBeUndefined();
        expect(await ledger.find('run_3')).toBeDefined();
    });
});

describe('broker rate limit', () => {
    function okDeps(caller: string): BrokerDeps {
        return {
            ledger: memoryLedger(),
            resolve: async () => ['1.1.1.1'],
            fetch: async () => ({ status: 200, headers: {}, text: '["ok"]' }),
            caller,
            now: () => 1_000_000
        };
    }

    it('counts every manifest against the same caller: the 31st request is 429', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < 31; i++) {
            const result = await broker({
                manifest: listManifest('server_broker', `https://board${i}.example.test`),
                input: {},
                idempotencyKey: `broker-key-rate-${i}`
            }, okDeps('198.51.100.7'));
            statuses.push(result.status);
        }
        expect(statuses.slice(0, 30).every(status => status === 200)).toBe(true);
        expect(statuses[30]).toBe(429);
    });

    it('a request counted before its body was read is not counted again', async () => {
        const one = createBrokerRateLimiter(1, 10);
        const admission = admitBrokerCaller('198.51.100.8', { limiter: one, now: () => 1_000_000 });
        expect(admission).not.toBeNull();
        const body = { manifest: listManifest(), input: {}, idempotencyKey: 'broker-key-admitted' };
        const first = await handleCapabilityBroker(body, { ...okDeps('198.51.100.8'), limiter: one, admission: admission! });
        expect(first.status).toBe(200);
        // An admission is spent once. Presenting it again, or an object that
        // was never issued, is counted like any other request.
        const reused = await handleCapabilityBroker(
            { ...body, idempotencyKey: 'broker-key-reused' },
            { ...okDeps('198.51.100.8'), limiter: one, admission: admission! }
        );
        expect(reused.status).toBe(429);
        const forged = await handleCapabilityBroker(
            { ...body, idempotencyKey: 'broker-key-forged' },
            { ...okDeps('198.51.100.8'), limiter: one, admission: { caller: '198.51.100.8' } }
        );
        expect(forged.status).toBe(429);
    });

    it('an over-budget caller gets no admission', () => {
        const one = createBrokerRateLimiter(1, 10);
        expect(admitBrokerCaller('198.51.100.9', { limiter: one, now: () => 0 })).not.toBeNull();
        expect(admitBrokerCaller('198.51.100.9', { limiter: one, now: () => 0 })).toBeNull();
    });

    it('gives a different caller its own budget, under a global cap', async () => {
        const small = createBrokerRateLimiter(2, 3);
        expect(small.allow('a', 0)).toBe(true);
        expect(small.allow('a', 0)).toBe(true);
        expect(small.allow('a', 0)).toBe(false);
        expect(small.allow('b', 0)).toBe(true);
        expect(small.allow('c', 0)).toBe(false);
        // Outside the window every entry is pruned and budgets return.
        expect(small.allow('c', 60_000)).toBe(true);
        expect(small.allow('a', 60_000)).toBe(true);
    });
});
