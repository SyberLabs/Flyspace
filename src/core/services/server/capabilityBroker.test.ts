import { describe, it, expect, beforeEach } from 'vitest';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { sealManifest } from '@/core/capabilities/manifest';
import { handleCapabilityBroker } from './capabilityBroker';
import { memoryLedger } from './capability.ledger';
import type { PinnedRequest } from './pinnedFetch';

function listManifest(access: 'browser_direct' | 'server_broker' = 'server_broker') {
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
    return sealManifest({
        ...compiled,
        transport: { ...compiled.transport, access }
    });
}

beforeEach(() => {
    // The broker's rate window is process-global. Unique manifests keep tests apart.
});

describe('capability broker', () => {
    it('fetches only after the resolved address is public', async () => {
        const seen: PinnedRequest[] = [];
        const result = await handleCapabilityBroker({
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
        const result = await handleCapabilityBroker({
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
        await handleCapabilityBroker(body, { ...deps, fetch });
        const replay = await handleCapabilityBroker(body, { ...deps, fetch });
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
        const result = await handleCapabilityBroker({
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
});
