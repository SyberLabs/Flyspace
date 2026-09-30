import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { credentialSlot } from './identity';
import {
    approveCapability,
    clearCapabilities,
    ensureSpeechCapabilities,
    installProposal
} from './registry';
import { executeCapability } from './execute';
import { latestExecutionRecord } from './executionLedger';
import { capabilitySecrets } from './secrets';
import { openSpeechSession, runSpeechHandler, setSpeechEngine } from './speech';
import { blockRegistry } from '../registry/BlockRegistry';
import { useBlockStore } from '../stores/blockStore';
import { useWireStore } from '../stores/wireStore';
import { wireService } from '../services/wire.service';

const BOARD = {
    openapi: '3.0.3',
    info: { title: 'Board', version: '1' },
    components: {
        securitySchemes: {
            ApiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' }
        }
    },
    security: [{ ApiKey: [] }],
    paths: {
        '/items': {
            get: {
                operationId: 'listItems',
                responses: {
                    '200': {
                        description: 'items',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { type: 'string' } }
                            }
                        }
                    }
                }
            },
            post: {
                operationId: 'act',
                'x-omni-effect': 'compute',
                responses: { '204': { description: 'done' } }
            }
        }
    }
};

function withServer(url: string) {
    return { ...BOARD, servers: [{ url }] };
}

beforeEach(() => {
    clearCapabilities();
    ensureSpeechCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    setSpeechEngine(null);
    clearCapabilities();
    capabilitySecrets.clear();
    vi.unstubAllGlobals();
});

describe('capability production boundaries', () => {
    it('does not let a second origin inherit the first origin credential', async () => {
        const first = compileOpenApi(withServer('https://a.example.test'));
        const second = compileOpenApi(withServer('https://evil.example.test'));
        const listA = first.manifests.find(manifest => manifest.source.operationId === 'listItems')!;
        const listB = second.manifests.find(manifest => manifest.source.operationId === 'listItems')!;
        expect(listA.id).not.toBe(listB.id);
        expect(listA.auth.secretRef).not.toBe(listB.auth.secretRef);
        expect(listA.auth.secretRef).toBe(credentialSlot('https://a.example.test', {
            kind: 'apiKey',
            in: 'header',
            name: 'X-Api-Key'
        }));
        installProposal(listA);
        installProposal(listB);
        capabilitySecrets.set(listA.auth.secretRef!, 'secret-a');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(['ok']), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })));
        const stolen = await executeCapability(listB.id, {});
        expect(stolen.error?.code).toBe('AUTH_UNBOUND');
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('refuses a POST that an OpenAPI document labels compute', () => {
        const compiled = compileOpenApi(withServer('https://board.example.test'));
        expect(compiled.errors.some(issue => issue.operation === 'act' && /cannot be declared compute/.test(issue.message))).toBe(true);
        expect(compiled.manifests.some(manifest => manifest.source.operationId === 'act')).toBe(false);
    });

    it('records an uncertain outcome when a write is dispatched and then throws', async () => {
        const spec = {
            openapi: '3.0.3',
            info: { title: 'Pay', version: '1' },
            servers: [{ url: 'https://pay.example.test' }],
            paths: {
                '/payments': {
                    post: {
                        operationId: 'pay',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        required: ['amount'],
                                        properties: { amount: { type: 'integer' } }
                                    }
                                }
                            }
                        },
                        responses: { '204': { description: 'accepted' } }
                    }
                }
            }
        };
        const pay = compileOpenApi(spec).manifests[0];
        installProposal(pay);
        approveCapability(pay.id);
        vi.stubGlobal('fetch', vi.fn(async () => {
            throw new Error('socket hang up');
        }));
        const result = await executeCapability(pay.id, { body: { amount: 10 } });
        expect(result.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(result.error?.retryable).toBe(false);
        expect(latestExecutionRecord(pay.id)?.status).toBe('uncertain');
        expect(latestExecutionRecord(pay.id)?.dispatchedAt).toBeTypeOf('number');
    });

    it('does not mark an observed write failure as safe to retry', async () => {
        const spec = {
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
        };
        const pay = compileOpenApi(spec).manifests[0];
        installProposal(pay);
        approveCapability(pay.id);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
        const result = await executeCapability(pay.id, {});
        expect(result.error?.code).toBe('HTTP_ERROR');
        expect(result.error?.retryable).toBe(false);
        expect(latestExecutionRecord(pay.id)?.status).toBe('failed');
    });

    it('stops reading once the declared body exceeds the budget', async () => {
        const list = compileOpenApi(withServer('https://a.example.test')).manifests
            .find(manifest => manifest.source.operationId === 'listItems')!;
        expect(list.auth.kind).toBe('apiKey');
        const open = compileOpenApi({
            ...withServer('https://a.example.test'),
            security: [],
            components: {}
        }).manifests.find(manifest => manifest.source.operationId === 'listItems')!;
        installProposal(open);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', {
            status: 200,
            headers: {
                'content-type': 'application/json',
                'content-length': String(2_000_000)
            }
        })));
        const result = await executeCapability(open.id, {});
        expect(result.error?.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('records a join_titles projection and still refuses a typed mismatch', () => {
        const compiled = compileOpenApi({
            ...withServer('https://a.example.test'),
            security: [],
            components: {}
        });
        const list = compiled.manifests.find(manifest => manifest.source.operationId === 'listItems')!;
        installProposal(list);
        const sourceId = useBlockStore.getState().addBlock(blockRegistry.get(list.id)!, { x: 0, y: 0 });
        const speakId = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_speak')!, { x: 40, y: 0 });
        const wireId = wireService.createWire(sourceId, speakId);
        expect(wireId).not.toBe('');
        expect(useWireStore.getState().getWire(wireId)?.projection).toEqual({ kind: 'join_titles' });

        const count = compileOpenApi({
            openapi: '3.0.3',
            info: { title: 'Count', version: '1' },
            servers: [{ url: 'https://count.example.test' }],
            paths: {
                '/n': {
                    post: {
                        operationId: 'count',
                        requestBody: {
                            required: true,
                            content: {
                                'application/json': { schema: { type: 'integer' } }
                            }
                        },
                        responses: { '204': { description: 'ok' } }
                    }
                }
            }
        }).manifests[0];
        installProposal(count);
        const countId = useBlockStore.getState().addBlock(blockRegistry.get(count.id)!, { x: 80, y: 0 });
        expect(useWireStore.getState().addWire(sourceId, countId)).toBe('');
    });

    it('cancels a speech session', async () => {
        const session = openSpeechSession('listen');
        session.cancel();
        expect(session.signal.aborted).toBe(true);
        setSpeechEngine({
            supported: () => ({ speak: true, listen: true }),
            locality: () => ({ speak: 'on_device', listen: 'on_device' }),
            speak: async () => undefined,
            listen: async () => 'noted aloud'
        });
        const heard = await runSpeechHandler('speech.listen', {}) as { transcript: string; source: string; sessionId: string };
        expect(heard).toMatchObject({ transcript: 'noted aloud', source: 'on_device' });
    });
});
