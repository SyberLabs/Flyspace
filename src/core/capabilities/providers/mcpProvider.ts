// MCP acquisition from tool schemas. Annotations become an effect hint and
// nothing more: the compiler is always called untrusted, and admission alone
// decides whether a server's read hint counts.

import { compileMcpTools, type McpToolSchema } from '../mcp';
import type { CapabilityEffect } from '../manifest';
import { ProviderMaterializeError, type CapabilityDiscovery, type CapabilityProvider } from '../provider';
import { candidateFromManifest, proposalFromManifest, type ProposalSource } from './fromManifest';

export interface McpToolLister {
    listTools(signal?: AbortSignal): Promise<McpToolSchema[]>;
}

export interface McpDiscoveryRequest {
    serverId: string;
    /** Static schemas, or a live lister (the SDK client in `mcpClient.ts`). */
    tools?: readonly McpToolSchema[];
    lister?: McpToolLister;
    sourceRevision?: string;
    discoveredAtMs?: number;
    signal?: AbortSignal;
}

export const MCP_PROVIDER_ID = 'mcp';

async function toolsFor(request: McpDiscoveryRequest): Promise<McpToolSchema[]> {
    const listed = request.tools ?? (request.lister ? await request.lister.listTools(request.signal) : []);
    return listed.map(tool => ({ ...tool, serverId: request.serverId }));
}

function hintFor(tool: McpToolSchema): CapabilityEffect | undefined {
    if (tool.annotations?.destructiveHint) return 'destructive';
    if (tool.annotations?.readOnlyHint) return 'read';
    return undefined;
}

function sourceFor(tool: McpToolSchema, request: McpDiscoveryRequest, now: number): ProposalSource {
    return {
        providerId: MCP_PROVIDER_ID,
        providerKind: 'mcp',
        externalId: tool.name,
        sourceLocator: request.serverId,
        ...(request.sourceRevision ? { sourceRevision: request.sourceRevision } : {}),
        discoveredAtMs: request.discoveredAtMs ?? now,
        ...(hintFor(tool) ? { effectHint: hintFor(tool) } : {})
    };
}

export const mcpProvider: CapabilityProvider<McpDiscoveryRequest> = {
    id: MCP_PROVIDER_ID,
    kind: 'mcp',

    async discover(request, context) {
        const now = context?.nowMs ?? Date.now();
        const discovery: CapabilityDiscovery = { candidates: [], issues: [] };
        for (const tool of await toolsFor(request)) {
            const compiled = compileMcpTools([tool], { trustedAnnotations: false });
            const manifest = compiled.manifests[0];
            if (manifest) {
                discovery.candidates.push(candidateFromManifest(manifest, sourceFor(tool, request, now)));
            } else {
                discovery.issues.push({ externalId: tool.name, message: compiled.errors[0]?.message ?? 'tool did not compile' });
            }
        }
        return discovery;
    },

    async materialize(candidate, context) {
        const tools = await toolsFor(context.request);
        const matches = tools.filter(tool => tool.name === candidate.externalId);
        if (matches.length !== 1) throw new ProviderMaterializeError(`tool ${candidate.externalId} does not name exactly one tool`);
        const compiled = compileMcpTools(matches, { trustedAnnotations: false });
        const manifest = compiled.manifests[0];
        if (!manifest) throw new ProviderMaterializeError(compiled.errors[0]?.message ?? 'tool did not compile');
        return proposalFromManifest(manifest, sourceFor(matches[0], context.request, candidate.provenance.discoveredAtMs));
    }
};
