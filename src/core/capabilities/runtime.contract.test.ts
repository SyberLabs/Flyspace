import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { approveCapability, clearCapabilities, installProposal } from './registry';
import { executeCapability } from './execute';
import { claimCreateTrigger, executionRecords } from './executionLedger';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Pay', version: '1' },
    servers: [{ url: 'https://pay.example.test' }],
    paths: {
        '/payments': {
            post: {
                operationId: 'pay',
                responses: { '204': { description: 'accepted' } }
            }
        },
        '/items': {
            get: {
                operationId: 'list',
                parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'items',
                        content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } }
                    }
                }
            }
        }
    }
};

beforeEach(() => {
    clearCapabilities();
    vi.unstubAllGlobals();
});

describe('capability execution ledger', () => {
    it('replays a completed key and refuses a different input', async () => {
        const list = compileOpenApi(SPEC).manifests.find(manifest => manifest.source.operationId === 'list')!;
        installProposal(list);
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(['a']), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })));
        const first = await executeCapability(list.id, {}, { idempotencyKey: 'same-key-1' });
        expect(first.ok).toBe(true);
        const second = await executeCapability(list.id, {}, { idempotencyKey: 'same-key-1' });
        expect(second.ok).toBe(true);
        expect(second.runId).toBe(first.runId);
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

        const conflict = await executeCapability(list.id, { q: 'other' }, { idempotencyKey: 'same-key-1' });
        expect(conflict.error?.code).toBe('IDEMPOTENCY_CONFLICT');
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it('does not dispatch again when a write is already uncertain', async () => {
        const pay = compileOpenApi(SPEC).manifests.find(manifest => manifest.source.operationId === 'pay')!;
        installProposal(pay);
        approveCapability(pay.id);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
        const first = await executeCapability(pay.id, {}, { idempotencyKey: 'pay-attempt-1' });
        expect(first.error?.code).toBe('EFFECT_UNCERTAIN');
        const second = await executeCapability(pay.id, {}, { idempotencyKey: 'pay-attempt-1' });
        expect(second.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(second.runId).toBe(first.runId);
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
        expect(executionRecords().find(record => record.runId === first.runId)?.status).toBe('uncertain');
    });

    it('claims on_create once per block instance', () => {
        expect(claimCreateTrigger('block-a')).toBe(true);
        expect(claimCreateTrigger('block-a')).toBe(false);
        expect(claimCreateTrigger('block-b')).toBe(true);
    });
});
