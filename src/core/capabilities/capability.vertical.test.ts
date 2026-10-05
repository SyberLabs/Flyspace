import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sha256 } from './hash';
import { credentialSlot } from './identity';
import { compileOpenApi } from './openapi';
import { compileMcpTools } from './mcp';
import { compileBring } from './bring';
import { validateManifest } from './manifest';
import {
    approveCapability,
    clearCapabilities,
    exportSnapshot,
    getCapability,
    installProposal,
    restoreSnapshot,
    runInstalledCapability,
    uninstallCapability
} from './registry';
import { bindMcpTransport, unbindMcpTransport } from './execute';
// Write runs need a confirmed preview; these tests exercise the engine after one.
import { executeConfirmed as executeCapability } from '../../../test/confirmedExecute';
import { capabilitySecrets } from './secrets';
import { blockRegistry } from '../registry/BlockRegistry';
import { useBlockStore } from '../stores/blockStore';
import { useWireStore } from '../stores/wireStore';
import { aggregateWireContext, wireService } from '../services/wire.service';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Sample Board', version: '1.0.0' },
    servers: [{ url: 'https://board.example.test/v1' }],
    security: [{ boardKey: [] }],
    paths: {
        '/posts': {
            get: {
                operationId: 'listPosts',
                summary: 'List posts',
                responses: {
                    '200': {
                        description: 'posts',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Post' } }
                            }
                        }
                    }
                }
            },
            post: {
                operationId: 'createPost',
                summary: 'Create post',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': { schema: { $ref: '#/components/schemas/PostDraft' } }
                    }
                },
                responses: {
                    '201': {
                        description: 'created',
                        content: {
                            'application/json': { schema: { $ref: '#/components/schemas/Post' } }
                        }
                    }
                }
            }
        },
        '/posts/{id}': {
            get: {
                operationId: 'getPost',
                summary: 'Get post',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'post',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Post' } } }
                    }
                }
            },
            delete: {
                operationId: 'deletePost',
                summary: 'Delete post',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { '204': { description: 'gone' } }
            }
        },
        '/search': {
            get: {
                operationId: 'searchPosts',
                summary: 'Search posts',
                'x-omni-effect': 'compute',
                parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'hits',
                        content: {
                            'application/json': {
                                schema: { type: 'array', items: { $ref: '#/components/schemas/Post' } }
                            }
                        }
                    }
                }
            }
        },
        '/admin': {
            get: {
                operationId: 'dangerousGet',
                summary: 'Not allowed',
                'x-omni-effect': 'destructive',
                responses: { '204': { description: 'no' } }
            }
        }
    },
    components: {
        securitySchemes: {
            boardKey: { type: 'apiKey', in: 'header', name: 'X-Board-Key' }
        },
        schemas: {
            Post: {
                type: 'object',
                required: ['id', 'title'],
                properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    body: { type: 'string' }
                }
            },
            PostDraft: {
                type: 'object',
                required: ['title'],
                properties: {
                    title: { type: 'string' },
                    body: { type: 'string' }
                }
            }
        }
    }
} as const;

const POSTS = [{ id: 'p1', title: 'Hello from the board', body: 'A note' }];

function byOp(operationId: string) {
    const manifest = manifests().manifests.find(entry => entry.source.operationId === operationId);
    if (!manifest) throw new Error(`missing ${operationId}`);
    return manifest;
}

function manifests() {
    return compileOpenApi(SPEC);
}

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    unbindMcpTransport('board');
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('capability compiler', () => {
    it('hashes with sha256', () => {
        expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
        expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('compiles an unknown OpenAPI document into checked manifests', () => {
        const compiled = manifests();
        const operations = compiled.manifests.map(manifest => manifest.source.operationId).sort();
        expect(operations).toEqual([
            'createPost',
            'dangerousGet',
            'deletePost',
            'getPost',
            'listPosts',
            'searchPosts'
        ]);
        expect(compiled.errors).toEqual([]);

        const list = byOp('listPosts');
        const create = byOp('createPost');
        const search = byOp('searchPosts');
        const remove = byOp('deletePost');
        const danger = byOp('dangerousGet');
        expect(list).toMatchObject({ effect: 'read', approval: 'auto', effectSource: 'method', invocation: 'manual' });
        expect(create).toMatchObject({ effect: 'write', approval: 'pending' });
        expect(search).toMatchObject({ effect: 'compute', approval: 'auto', effectSource: 'extension' });
        expect(remove).toMatchObject({ effect: 'destructive', approval: 'pending' });
        expect(danger).toMatchObject({ effect: 'destructive', approval: 'pending', effectSource: 'extension' });
        expect(list.output.schema.kind).toBe('array');
        expect(list.transport).toMatchObject({ kind: 'http', access: 'browser_direct' });
        expect(list.auth).toEqual({
            kind: 'apiKey',
            in: 'header',
            name: 'X-Board-Key',
            secretRef: credentialSlot('https://board.example.test/v1', { kind: 'apiKey', in: 'header', name: 'X-Board-Key' })
        });
        expect(byOp('listPosts').id).not.toBe(byOp('createPost').id);
        expect(list.id.startsWith('cap_')).toBe(true);
        expect(JSON.stringify(compiled.manifests)).not.toContain('super-secret');
    });

    it('rejects a tampered proposal and will not auto-approve a write', () => {
        const create = byOp('createPost');
        const tampered = { ...create, title: 'Overwrite' };
        expect(validateManifest(tampered).ok).toBe(false);

        const claimed = { ...create, approval: 'approved' as const, apiKey: 'super-secret' };
        const installed = installProposal(claimed);
        expect(installed.ok).toBe(false);
        expect(blockRegistry.has(create.id)).toBe(false);

        const blessed = { ...create, approval: 'approved' as const };
        expect(validateManifest(blessed).ok).toBe(true);
        expect(installProposal(blessed).manifest?.approval).toBe('pending');
    });

    it('turns the sample API into a wired block, and removes it, without a catalog edit', async () => {
        expect(blockRegistry.has('polymarket_live_odds')).toBe(true);

        const list = byOp('listPosts');
        expect(installProposal(list).ok).toBe(true);
        expect(blockRegistry.get(list.id)?.capabilityId).toBe(list.id);
        expect(blockRegistry.get(list.id)?.ports?.find(port => port.id === 'out')?.schema?.kind).toBe('array');

        const calls: Array<{ url: string; init?: RequestInit }> = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url: String(url), init });
            return new Response(JSON.stringify(POSTS), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }));

        const unbound = await executeCapability(byOp('listPosts').id, {});
        expect(unbound.error?.code).toBe('AUTH_UNBOUND');
        expect(calls).toHaveLength(0);

        capabilitySecrets.set(byOp('listPosts').auth.secretRef!, 'super-secret');
        const result = await executeCapability(byOp('listPosts').id, {});
        expect(result.ok).toBe(true);
        expect(result.typed?.value).toEqual(POSTS);
        expect(result.presentation.items?.[0]?.title).toBe('Hello from the board');
        expect(result.presentation).not.toHaveProperty('typed');
        expect(calls[0]?.url).toBe('https://board.example.test/v1/posts');
        expect(new Headers(calls[0]?.init?.headers).get('X-Board-Key')).toBe('super-secret');

        const schema = blockRegistry.get(byOp('listPosts').id);
        expect(schema).toBeDefined();
        const instanceId = useBlockStore.getState().addBlock(schema!, { x: 0, y: 0 });
        const personaSchema = blockRegistry.get('persona_analyst');
        const personaId = useBlockStore.getState().addBlock(personaSchema!, { x: 400, y: 0 });
        await runInstalledCapability(instanceId);
        const wireId = wireService.createWire(instanceId, personaId);
        expect(wireId).not.toBe('');
        expect(aggregateWireContext(personaId).context).toContain('Hello from the board');

        const catalogSource = useBlockStore.getState().addBlock(blockRegistry.get('hackernews_feed')!, { x: 0, y: 200 });
        expect(wireService.createWire(catalogSource, personaId)).not.toBe('');

        const count = compileBring({
            title: 'Count posts',
            baseUrl: 'https://board.example.test/v1',
            method: 'POST',
            path: '/count',
            inputs: [{
                name: 'count',
                in: 'body',
                required: true,
                schema: { kind: 'integer' }
            }],
            output: { schema: { kind: 'integer' } }
        });
        expect(count.errors).toEqual([]);
        expect(installProposal(count.manifests[0]).ok).toBe(true);
        const countId = useBlockStore.getState().addBlock(blockRegistry.get(count.manifests[0].id)!, { x: 200, y: 200 });
        expect(wireService.createWire(instanceId, countId)).toBe('');
        expect(useWireStore.getState().wireExists(instanceId, countId)).toBe(false);

        const listId = byOp('listPosts').id;
        expect(uninstallCapability(listId)).toBe(true);
        expect(blockRegistry.has(listId)).toBe(false);
        expect(useBlockStore.getState().getBlock(instanceId)).toBeUndefined();
        expect(blockRegistry.has('polymarket_live_odds')).toBe(true);
    });

    it('refuses write and destructive calls until an explicit approval', async () => {
        const create = byOp('createPost');
        const remove = byOp('deletePost');
        installProposal(create);
        installProposal(remove);
        capabilitySecrets.set(create.auth.secretRef!, 'super-secret');

        const calls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            calls.push(`${init?.method ?? 'GET'} ${String(url)}`);
            return new Response(JSON.stringify({ id: 'p2', title: 'Hi' }), {
                status: 201,
                headers: { 'content-type': 'application/json' }
            });
        }));

        const refused = await executeCapability(byOp('createPost').id, { body: { title: 'Hi' } });
        expect(refused.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(calls).toHaveLength(0);

        expect(approveCapability(byOp('createPost').id).manifest?.approval).toBe('approved');
        const created = await executeCapability(byOp('createPost').id, { body: { title: 'Hi' } });
        expect(created.ok).toBe(true);
        expect(calls[0]).toBe('POST https://board.example.test/v1/posts');

        const deleted = await executeCapability(byOp('deletePost').id, { id: 'p2' });
        expect(deleted.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(calls).toHaveLength(1);
    });

    it('fails closed when the response does not match the output schema', async () => {
        const list = byOp('listPosts');
        installProposal(list);
        capabilitySecrets.set(list.auth.secretRef!, 'super-secret');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })));

        const result = await executeCapability(list.id, {});
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe('TYPED_OUTPUT_MISMATCH');
        expect(result.typed).toBeNull();
        expect(result.presentation.error?.code).toBe('TYPED_OUTPUT_MISMATCH');
    });

    it('keeps an approval across a snapshot and still revalidates', async () => {
        const create = byOp('createPost');
        installProposal(create);
        approveCapability(create.id);
        const snapshot = exportSnapshot();
        expect(JSON.stringify(snapshot)).not.toContain('super-secret');

        clearCapabilities();
        expect(getCapability(create.id)).toBeUndefined();
        const restored = restoreSnapshot(snapshot);
        expect(restored.installed).toContain(create.id);
        expect(getCapability(create.id)?.approval).toBe('approved');

        const forged = {
            version: 1 as const,
            manifests: [{ ...snapshot.manifests[0], title: 'Forged' }]
        };
        const rejected = restoreSnapshot(forged);
        expect(rejected.installed).not.toContain(create.id);
        expect(rejected.rejected[0]?.errors.join(' ')).toMatch(/digest/);
    });

    it('gives two MCP servers with the same label and tool at different origins distinct ids that coexist', () => {
        const tool = {
            serverId: 'board',
            name: 'list_board',
            inputSchema: { type: 'object', properties: {} },
            outputSchema: { type: 'array', items: { type: 'string' } }
        };
        const [first] = compileMcpTools([{ ...tool, origin: 'https://board.example.test' }]).manifests;
        const [second] = compileMcpTools([{ ...tool, origin: 'https://other.example.test' }]).manifests;
        expect(first.id).not.toBe(second.id);
        expect(installProposal(first).ok).toBe(true);
        expect(installProposal(second).ok).toBe(true);
        expect(getCapability(first.id)?.transport).toMatchObject({ origin: 'https://board.example.test' });
        expect(getCapability(second.id)?.transport).toMatchObject({ origin: 'https://other.example.test' });
    });

    it('compiles MCP tools and Bring descriptions through the same gate', async () => {
        const compiled = compileMcpTools([
            {
                serverId: 'board',
                origin: 'https://board.example.test',
                name: 'list_board',
                description: 'Read the board',
                annotations: { readOnlyHint: true },
                inputSchema: {
                    type: 'object',
                    properties: { q: { type: 'string' } }
                },
                outputSchema: { type: 'array', items: { type: 'string' } }
            },
            {
                serverId: 'board',
                origin: 'https://board.example.test',
                name: 'wipe_board',
                annotations: { readOnlyHint: true, destructiveHint: true },
                outputSchema: { type: 'boolean' }
            }
        ]);
        expect(compiled.errors).toEqual([]);
        const read = compiled.manifests.find(manifest => manifest.source.operationId === 'list_board');
        const wipe = compiled.manifests.find(manifest => manifest.source.operationId === 'wipe_board');
        expect(read).toMatchObject({ effect: 'write', approval: 'pending' });
        const trusted = compileMcpTools([{
            serverId: 'board',
            origin: 'https://board.example.test',
            name: 'list_board',
            annotations: { readOnlyHint: true },
            inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
            outputSchema: { type: 'array', items: { type: 'string' } }
        }], { trustedAnnotations: true });
        expect(trusted.manifests[0]).toMatchObject({ effect: 'read', approval: 'auto' });
        expect(wipe).toMatchObject({ effect: 'destructive', approval: 'pending' });
        const trustedRead = trusted.manifests[0];
        installProposal(trustedRead);
        installProposal(wipe);

        const calls: unknown[] = [];
        bindMcpTransport('board', {
            origin: 'https://board.example.test',
            call: async (_server, tool, args) => {
                calls.push({ tool, args });
                return ['alpha'];
            }
        });

        const wiped = await executeCapability(wipe!.id, {});
        expect(wiped.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(calls).toHaveLength(0);

        const listed = await executeCapability(trustedRead.id, { q: 'alpha' });
        expect(listed.ok).toBe(true);
        expect(listed.typed?.value).toEqual(['alpha']);
        expect(calls).toEqual([{ tool: 'list_board', args: { q: 'alpha' } }]);

        unbindMcpTransport('board');
        const unbound = await executeCapability(trustedRead.id, {});
        expect(unbound.error?.code).toBe('TRANSPORT_NOT_BOUND');

        const brought = compileBring({
            title: 'Ping board',
            baseUrl: 'https://board.example.test/v1',
            method: 'GET',
            path: '/health',
            output: { schema: { kind: 'object', properties: { ok: { kind: 'boolean' } }, required: ['ok'] } }
        });
        expect(brought.manifests[0]).toMatchObject({ effect: 'read', approval: 'auto', source: { kind: 'bring' } });
        expect(installProposal({ ...brought.manifests[0], token: 'raw-token' }).ok).toBe(false);
    });
});
