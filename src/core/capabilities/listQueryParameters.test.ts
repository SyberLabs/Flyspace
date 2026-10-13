import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coerceInput } from '@/blocks/capability/CapabilityInputs';
import { executeCapability, previewCapabilityRun } from './execute';
import { setQueryParam } from './httpTarget';
import { compileOpenApi } from './openapi';
import { clearCapabilities, installProposal } from './registry';
import { capabilitySecrets } from './secrets';
import { createBrokerRateLimiter, handleCapabilityBroker } from '../services/server/capabilityBroker';
import { memoryLedger } from '../services/server/capability.ledger';
import type { PinnedRequest } from '../services/server/pinnedFetch';

/** YouTube's shape: `part` is a required list in the query. */
function spec(part: Record<string, unknown>, method = 'get') {
    return {
        openapi: '3.0.3',
        info: { title: 'Videos', version: '1' },
        servers: [{ url: 'https://videos.example.test' }],
        paths: {
            '/videos': {
                [method]: {
                    operationId: 'videos.list',
                    parameters: [
                        { name: 'part', in: 'query', required: true, ...part },
                        { name: 'id', in: 'query', schema: { type: 'string' } }
                    ],
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { kind: { type: 'string' } } } } } } }
                }
            }
        }
    };
}

const LIST = { style: 'form', explode: true, schema: { type: 'array', items: { type: 'string' } } };

describe('compiling a list-valued query parameter', () => {
    it('accepts a required list of plain values on a read', () => {
        const { manifests, errors } = compileOpenApi(spec(LIST));
        expect(errors).toEqual([]);
        expect(manifests[0].inputs.find(input => input.name === 'part')).toMatchObject({ required: true, schema: { kind: 'array', items: { kind: 'string' } } });
    });

    it('accepts one with no style or explode given, the OpenAPI default for a query', () => {
        expect(compileOpenApi(spec({ schema: { type: 'array', items: { type: 'integer' } } })).manifests).toHaveLength(1);
    });

    it('still refuses a comma-joined list, a list of objects, and any list on a write', () => {
        const refused = (part: Record<string, unknown>, method?: string) => compileOpenApi(spec(part, method)).errors[0]?.message;
        expect(refused({ ...LIST, explode: false })).toBe('part: compound query parameters are outside the supported subset');
        expect(refused({ schema: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } } })).toBe('part: compound query parameters are outside the supported subset');
        expect(refused(LIST, 'post')).toBe('part: compound query parameters are outside the supported subset');
    });
});

describe('sending a list in the query', () => {
    it('repeats the name once per element, in order', () => {
        const params = new URLSearchParams('part=old');
        setQueryParam(params, 'part', ['snippet', 'statistics']);
        expect(params.toString()).toBe('part=snippet&part=statistics');
    });

    beforeEach(() => {
        clearCapabilities();
        capabilitySecrets.clear();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        clearCapabilities();
    });

    it('from the browser', async () => {
        const [manifest] = compileOpenApi(spec(LIST)).manifests;
        expect(installProposal(manifest).ok).toBe(true);
        const preview = previewCapabilityRun(manifest.id, { part: ['snippet', 'statistics'], id: 'abc' });
        expect(preview.ok && preview.preview.url).toBe('https://videos.example.test/videos?id=abc&part=snippet&part=statistics');
        const fetchMock = vi.fn(async (_url: string) => new Response('{"kind":"list"}', { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await executeCapability(manifest.id, { part: ['snippet'] });
        expect(result.error).toBeUndefined();
        expect(new URL(fetchMock.mock.calls[0][0]).searchParams.getAll('part')).toEqual(['snippet']);
    });

    it('through the broker', async () => {
        const [manifest] = compileOpenApi(spec(LIST), { brokerOrigins: ['https://videos.example.test'] }).manifests;
        const seen: PinnedRequest[] = [];
        await handleCapabilityBroker({ manifest, input: { part: ['snippet', 'statistics'] }, idempotencyKey: 'list-param-1' }, {
            ledger: memoryLedger(),
            limiter: createBrokerRateLimiter(),
            resolve: async () => ['1.1.1.1'],
            fetch: async request => {
                seen.push(request);
                return { status: 200, headers: {}, text: '{"kind":"list"}' };
            }
        });
        expect(seen[0].url.searchParams.getAll('part')).toEqual(['snippet', 'statistics']);
    });
});

describe('typing a list', () => {
    const [manifest] = compileOpenApi(spec(LIST)).manifests;
    const part = manifest.inputs.find(input => input.name === 'part')!;

    it('splits comma-separated text, and treats an empty one as no value', () => {
        expect(coerceInput(part, ' snippet,  statistics ,')).toEqual(['snippet', 'statistics']);
        expect(coerceInput(part, ' , ')).toBeUndefined();
    });

    it('still takes a JSON array', () => {
        expect(coerceInput(part, '["snippet"]')).toEqual(['snippet']);
    });
});
