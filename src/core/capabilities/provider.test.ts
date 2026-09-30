import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { compileMcpTools, type McpToolSchema } from './mcp';
import { compileBring, type BringApiDescription } from './bring';
import { admitProposal, manifestFromProposal } from './admission';
import { credentialSlot, transportCredentialSlot } from './identity';
import { clearCapabilities, ensureSpeechCapabilities, getCapability, installProposal, approveCapability } from './registry';
import { executeCapability } from './execute';
import { capabilitySecrets } from './secrets';
import { sealManifest, validateManifest, type CapabilityManifest } from './manifest';
import type { CapabilityProposalV1, CapabilityProvider } from './provider';
import { openapiProvider } from './providers/openapiProvider';
import { mcpProvider } from './providers/mcpProvider';
import { bringProvider } from './providers/bringProvider';
import { useBlockStore } from '../stores/blockStore';
import { useWireStore } from '../stores/wireStore';

const NOW = 1_790_000_000_000;

const BOARD = {
    openapi: '3.0.3',
    info: { title: 'Board', version: '7' },
    servers: [{ url: 'https://board.example.test/v1' }],
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
                summary: 'List items',
                responses: {
                    '200': {
                        description: 'items',
                        content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } }
                    }
                }
            },
            post: {
                operationId: 'createItem',
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } }
                },
                responses: { '204': { description: 'created' } }
            }
        },
        '/items/{id}': {
            get: {
                operationId: 'readItem',
                'x-omni-effect': 'destructive',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { '204': { description: 'gone' } }
            }
        }
    }
};

const TOOLS: McpToolSchema[] = [
    {
        serverId: 'board',
        name: 'list',
        annotations: { readOnlyHint: true },
        inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
        outputSchema: { type: 'array', items: { type: 'string' } }
    },
    {
        serverId: 'board',
        name: 'wipe',
        annotations: { destructiveHint: true },
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'null' }
    }
];

const BRING: BringApiDescription = {
    title: 'Echo',
    baseUrl: 'https://echo.example.test',
    method: 'GET',
    path: '/echo',
    effect: 'compute',
    auth: { kind: 'bearer', secretRef: 'cred_attacker_supplied' },
    inputs: [{ name: 'q', in: 'query', required: true, schema: { kind: 'string' } }],
    output: { schema: { kind: 'string' } }
};

async function proposalsOf<T>(provider: CapabilityProvider<T>, request: T): Promise<CapabilityProposalV1[]> {
    const discovered = await provider.discover(request, { nowMs: NOW });
    return Promise.all(discovered.candidates.map(candidate => provider.materialize(candidate, { request })));
}

function executionShape(manifest: CapabilityManifest) {
    return {
        id: manifest.id,
        effect: manifest.effect,
        effectSource: manifest.effectSource,
        approval: manifest.approval,
        auth: manifest.auth,
        transport: manifest.transport,
        inputs: manifest.inputs,
        output: manifest.output,
        trigger: manifest.trigger
    };
}

beforeEach(() => {
    clearCapabilities();
    ensureSpeechCapabilities();
    capabilitySecrets.clear();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    vi.unstubAllGlobals();
});

describe('provider seam keeps the compilers as the only parsers', () => {
    it('OpenAPI provider proposals admit to the same execution contract as compileOpenApi', async () => {
        const compiled = compileOpenApi(BOARD);
        const proposals = await proposalsOf(openapiProvider, { document: BOARD });
        expect(proposals).toHaveLength(compiled.manifests.length);
        for (const proposal of proposals) {
            const admitted = manifestFromProposal(proposal, { nowMs: NOW });
            expect(admitted.errors).toEqual([]);
            const direct = compiled.manifests.find(manifest => manifest.id === admitted.manifest!.id)!;
            expect(executionShape(admitted.manifest!)).toEqual(executionShape(direct));
            expect(admitted.manifest!.source).toEqual(direct.source);
        }
    });

    it('MCP provider proposals admit to the untrusted compileMcpTools contract', async () => {
        const compiled = compileMcpTools(TOOLS);
        const proposals = await proposalsOf(mcpProvider, { serverId: 'board', tools: TOOLS });
        for (const proposal of proposals) {
            const admitted = manifestFromProposal(proposal, { nowMs: NOW }).manifest!;
            const direct = compiled.manifests.find(manifest => manifest.id === admitted.id)!;
            expect(executionShape(admitted)).toEqual(executionShape(direct));
        }
        const list = proposals.find(proposal => proposal.externalIdentity.operationId === 'list')!;
        expect(list.effectHint).toBe('read');
        expect(manifestFromProposal(list).manifest).toMatchObject({ effect: 'write', approval: 'pending' });
    });

    it('Bring provider drops a supplied secretRef and admission derives the slot', async () => {
        const [proposal] = await proposalsOf(bringProvider, { description: BRING });
        expect(JSON.stringify(proposal)).not.toContain('cred_attacker_supplied');
        const admitted = manifestFromProposal(proposal, { nowMs: NOW }).manifest!;
        const direct = compileBring(BRING).manifests[0];
        expect(executionShape(admitted)).toEqual(executionShape(direct));
        expect(admitted.auth.secretRef).toBe(credentialSlot('https://echo.example.test', { kind: 'bearer' }));
    });

    it('records provenance under the digest', async () => {
        const [list] = await proposalsOf(openapiProvider, { document: BOARD });
        const admitted = admitProposal(list, { nowMs: NOW + 5 });
        expect(admitted.ok).toBe(true);
        expect(admitted.manifest!.provenance).toMatchObject({
            providerId: 'openapi',
            providerKind: 'openapi',
            externalId: 'listItems',
            sourceLocator: 'Board@7',
            sourceRevision: '7',
            discoveredAtMs: NOW,
            admittedAtMs: NOW + 5
        });
        const tampered = { ...admitted.manifest!, provenance: { ...admitted.manifest!.provenance!, providerId: 'maxun' } };
        expect(validateManifest(tampered).errors).toContain('digest does not match the manifest body');
        const schemaSwap = {
            ...admitted.manifest!,
            provenance: { ...admitted.manifest!.provenance!, schemaDigest: 'a'.repeat(64) }
        };
        expect(validateManifest(schemaSwap).errors).toContain('provenance.schemaDigest does not match inputs and output');
    });

    it('reports what the source could not represent', async () => {
        const discovered = await openapiProvider.discover({
            document: { ...BOARD, paths: { '/x': { get: { operationId: 'x', parameters: [{ name: 'c', in: 'cookie' }], responses: { '204': {} } } } } }
        });
        expect(discovered.candidates).toHaveLength(0);
        expect(discovered.issues).toEqual([{ externalId: 'x', message: 'cookie parameters are unsupported' }]);
    });
});

describe('host admission gate', () => {
    async function listProposal(): Promise<CapabilityProposalV1> {
        const proposals = await proposalsOf(openapiProvider, { document: BOARD });
        return proposals.find(proposal => proposal.externalIdentity.operationId === 'createItem')!;
    }

    it('refuses a forged approval, id, digest, or trust flag', async () => {
        const create = await listProposal();
        for (const [key, value] of [['approval', 'approved'], ['id', 'cap_speech_speak'], ['digest', 'f'.repeat(64)], ['trusted', true], ['effect', 'read']] as const) {
            const forged = { ...create, [key]: value };
            const result = admitProposal(forged);
            expect(result.ok).toBe(false);
            expect(result.errors.some(error => error.startsWith(`proposal.${key} is not a proposal field`))).toBe(true);
        }
        expect(getCapability('cap_speech_speak')?.transport.kind).toBe('local');
    });

    it('lands a write as pending and execution refuses it until approveCapability', async () => {
        const create = await listProposal();
        const result = admitProposal(create);
        expect(result.manifest).toMatchObject({ effect: 'write', approval: 'pending' });
        capabilitySecrets.set(result.manifest!.auth.secretRef!, 'key');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
        const refused = await executeCapability(result.manifest!.id, { body: { name: 'x' } });
        expect(refused.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
        approveCapability(result.manifest!.id);
        const ran = await executeCapability(result.manifest!.id, { body: { name: 'x' } });
        expect(ran.ok).toBe(true);
    });

    it('refuses an effect hint below the method floor', async () => {
        const create = await listProposal();
        expect(admitProposal({ ...create, effectHint: 'compute' }).errors).toEqual(['POST cannot be declared compute']);
        const del = { ...create, transport: { ...create.transport, method: 'DELETE' as const }, inputs: [], effectHint: 'write' as const };
        expect(admitProposal(del).errors).toEqual(['DELETE cannot be declared write']);
    });

    it('lets a hint raise the floor on a safe method', async () => {
        const proposals = await proposalsOf(openapiProvider, { document: BOARD });
        const read = proposals.find(proposal => proposal.externalIdentity.operationId === 'readItem')!;
        expect(read.effectHint).toBe('destructive');
        expect(admitProposal(read).manifest).toMatchObject({ effect: 'destructive', approval: 'pending', effectSource: 'extension' });
    });

    it('accepts an MCP read hint only from a host-trusted server', async () => {
        const [list] = await proposalsOf(mcpProvider, { serverId: 'board', tools: TOOLS });
        expect(admitProposal(list).manifest).toMatchObject({ effect: 'write', approval: 'pending', effectSource: 'declared' });
        expect(admitProposal(list, { trustedEffectHints: { mcpServers: ['other'] } }).manifest?.effect).toBe('write');
        expect(admitProposal(list, { trustedEffectHints: { mcpServers: ['board'] } }).manifest)
            .toMatchObject({ effect: 'read', approval: 'auto', effectSource: 'annotation' });
    });

    it('refuses a credential slot named by the provider', async () => {
        const create = await listProposal();
        const foreign = credentialSlot('https://other.example.test', { kind: 'apiKey', in: 'header', name: 'X-Api-Key' });
        const result = admitProposal({ ...create, auth: { ...create.auth, secretRef: foreign } });
        expect(result.ok).toBe(false);
        expect(result.errors[0]).toMatch(/^proposal\.auth\.secretRef is not a proposal field/);
    });

    it('binds an MCP credential to the server id, never to an HTTP origin slot', async () => {
        const auth = { kind: 'apiKey' as const, in: 'header' as const, name: 'x-api-key' };
        const [list] = await proposalsOf(mcpProvider, { serverId: 'board', tools: TOOLS, auth });
        const admitted = admitProposal(list).manifest!;
        expect(admitted.auth.secretRef).toBe(transportCredentialSlot(admitted.transport, admitted.auth));
        const httpSlot = credentialSlot('https://board.example.test', auth);
        expect(admitted.auth.secretRef).not.toBe(httpSlot);
        const { digest: _digest, ...draft } = admitted;
        const borrowed = sealManifest({ ...draft, auth: { ...admitted.auth, secretRef: httpSlot } });
        expect(validateManifest(borrowed).errors.some(error => error.startsWith('auth.secretRef must be'))).toBe(true);
        const query = await proposalsOf(mcpProvider, { serverId: 'board', tools: TOOLS, auth: { ...auth, in: 'query' } });
        expect(admitProposal(query[0]).errors).toContain('mcp credentials travel in a header');
    });

    it('refuses a local transport, a mismatched origin, or a provenance that names another provider', async () => {
        const create = await listProposal();
        expect(admitProposal({ ...create, transport: { kind: 'local', handler: 'speech.speak' } }).ok).toBe(false);
        expect(admitProposal({ ...create, externalIdentity: { ...create.externalIdentity, origin: 'https://evil.example.test' } }).errors)
            .toContain('proposal.externalIdentity.origin does not match the transport');
        expect(admitProposal({ ...create, provenance: { ...create.provenance, providerId: 'mcp' } }).errors)
            .toContain('proposal.provenance.providerId must match proposal.provider.id');
    });

    it('does not place a block or a wire', async () => {
        const proposals = await proposalsOf(openapiProvider, { document: BOARD });
        for (const proposal of proposals) admitProposal(proposal);
        expect(useBlockStore.getState().blocks).toHaveLength(0);
        expect(useWireStore.getState().wires).toHaveLength(0);
    });

    it('keeps the existing install path for compiler output', () => {
        const [list] = compileOpenApi(BOARD).manifests;
        expect(installProposal(list).ok).toBe(true);
        expect(getCapability(list.id)?.provenance).toBeUndefined();
    });
});
