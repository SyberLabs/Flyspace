import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sha256 } from './hash';
import { canonicalCapabilityId, credentialSlot } from './identity';
import { compileOpenApi } from './openapi';
import {
    approvalForEffect,
    sealManifest,
    validateManifest,
    type CapabilityEffect,
    type CapabilityInput,
    type CapabilityManifest
} from './manifest';
import { dropImportedApprovals } from './importAdmission';
import {
    type CapabilitySnapshot,
    approveCapability,
    clearCapabilities,
    installProposal,
    restoreSnapshot,
    runInstalledCapability,
    uninstallCapability
} from './registry';
import { bindLocalHandler, unbindLocalHandler } from './execute';
import { allCapabilities, readCapability } from './state';
// Write runs need a confirmed preview; these tests exercise the engine after one.
import { executeConfirmed as executeCapability } from '../../../test/confirmedExecute';
import { capabilitySecrets } from './secrets';
import { blockRegistry } from '../registry/BlockRegistry';
import { useBlockStore } from '../stores/blockStore';
import { useWireStore } from '../stores/wireStore';
import { wireService } from '../services/wire.service';

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
    unbindLocalHandler('board.list_board');
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** A manifest for one local handler, as the host would install it. */
function localManifest(
    toolName: string,
    effect: CapabilityEffect,
    inputs: CapabilityInput[],
    output: CapabilityManifest['output']
): CapabilityManifest {
    const transport = { kind: 'local' as const, handler: `board.${toolName}` };
    return sealManifest({
        version: 1,
        id: canonicalCapabilityId(transport),
        title: toolName,
        source: { kind: 'bring', locator: 'board', operationId: toolName },
        effect,
        effectSource: effect === 'write' ? 'declared' : 'annotation',
        approval: approvalForEffect(effect),
        invocation: 'manual',
        auth: { kind: 'none' },
        transport,
        inputs,
        output
    });
}

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
        expect(JSON.stringify(useBlockStore.getState().getBlock(instanceId)?.data)).toContain('Hello from the board');
        expect(useWireStore.getState().getWiresToBlock(personaId).map(wire => wire.id)).toContain(wireId);

        const catalogSource = useBlockStore.getState().addBlock(blockRegistry.get('hackernews_feed')!, { x: 0, y: 200 });
        expect(wireService.createWire(catalogSource, personaId)).not.toBe('');

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
        const snapshot: CapabilitySnapshot = { version: 1, manifests: allCapabilities() };
        expect(JSON.stringify(snapshot)).not.toContain('super-secret');

        clearCapabilities();
        expect(readCapability(create.id)).toBeUndefined();
        const restored = restoreSnapshot(snapshot);
        expect(restored.installed).toContain(create.id);
        expect(readCapability(create.id)?.approval).toBe('approved');

        const forged = {
            version: 1 as const,
            manifests: [{ ...snapshot.manifests[0], title: 'Forged' }]
        };
        const rejected = restoreSnapshot(forged);
        expect(rejected.installed).not.toContain(create.id);
        expect(rejected.rejected[0]?.errors.join(' ')).toMatch(/digest/);
    });

    it('gives the same operation at two origins distinct ids and credential slots that coexist', () => {
        const first = byOp('listPosts');
        const second = compileOpenApi({ ...SPEC, servers: [{ url: 'https://other.example.test/v1' }] }).manifests
            .find(entry => entry.source.operationId === 'listPosts')!;
        expect(first.id).not.toBe(second.id);
        expect(first.auth.secretRef).not.toBe(second.auth.secretRef);
        expect(installProposal(first).ok).toBe(true);
        expect(installProposal(second).ok).toBe(true);
        expect(readCapability(first.id)?.transport).toMatchObject({ baseUrl: 'https://board.example.test/v1' });
        expect(readCapability(second.id)?.transport).toMatchObject({ baseUrl: 'https://other.example.test/v1' });
    });

    it('an imported capability blob lands writes pending; the same blob through rehydrate keeps approval', () => {
        const create = byOp('createPost');
        const list = byOp('listPosts');
        installProposal(create);
        installProposal(list);
        approveCapability(create.id);
        const snapshot: CapabilitySnapshot = { version: 1, manifests: allCapabilities() };
        // The persisted envelope the capability store writes to the vault.
        const persisted = JSON.stringify({ state: snapshot, version: 1 });

        // Import path: approval is dropped, nothing else changes, so the digest
        // still validates and the read capability is untouched.
        const imported = dropImportedApprovals(persisted);
        expect(imported.needsApproval).toEqual([{ id: create.id, title: create.title, effect: 'write' }]);
        const admitted = JSON.parse(imported.blob) as { state: CapabilitySnapshot; version: number };
        expect(admitted.version).toBe(1);
        expect(admitted.state.manifests.find(m => m.id === list.id)).toEqual(snapshot.manifests.find(m => m.id === list.id));

        clearCapabilities();
        const fromImport = restoreSnapshot(admitted.state);
        expect(fromImport.installed).toEqual(expect.arrayContaining([create.id, list.id]));
        expect(fromImport.rejected).toEqual([]);
        expect(readCapability(create.id)?.approval).toBe('pending');
        expect(readCapability(create.id)?.digest).toBe(create.digest);
        expect(readCapability(list.id)?.approval).toBe('auto');
        // Pending is the same state installProposal leaves; approval is the only way out.
        expect(readCapability(create.id)).toEqual(installProposal({ ...create, approval: 'approved' }).manifest);

        // Rehydrate path (the browser's own blob): the granted approval survives.
        clearCapabilities();
        restoreSnapshot(snapshot);
        expect(readCapability(create.id)?.approval).toBe('approved');
    });

    it('runs a local read only through its bound handler and holds a destructive one for approval', async () => {
        const trustedRead = localManifest(
            'list_board',
            'read',
            [{ name: 'q', in: 'argument', required: false, schema: { kind: 'string' } }],
            { schema: { kind: 'array', items: { kind: 'string' } }, presentation: 'items' }
        );
        const wipe = localManifest('wipe_board', 'destructive', [], { schema: { kind: 'boolean' }, presentation: 'raw' });
        expect(trustedRead).toMatchObject({ effect: 'read', approval: 'auto' });
        expect(wipe).toMatchObject({ effect: 'destructive', approval: 'pending' });
        expect(installProposal(trustedRead).ok).toBe(true);
        expect(installProposal(wipe).ok).toBe(true);

        const calls: unknown[] = [];
        bindLocalHandler('board.list_board', async (args) => {
            calls.push({ args: { ...args } });
            return ['alpha'];
        });

        const wiped = await executeCapability(wipe.id, {});
        expect(wiped.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(calls).toHaveLength(0);

        const listed = await executeCapability(trustedRead.id, { q: 'alpha' });
        expect(listed.ok).toBe(true);
        expect(listed.typed?.value).toEqual(['alpha']);
        expect(calls).toEqual([{ args: { q: 'alpha' } }]);

        unbindLocalHandler('board.list_board');
        const unbound = await executeCapability(trustedRead.id, {});
        expect(unbound.error?.code).toBe('TRANSPORT_NOT_BOUND');
    });
});
