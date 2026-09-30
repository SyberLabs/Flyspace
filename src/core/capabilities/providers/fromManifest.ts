// Compilers seal a manifest to prove the source was representable. Providers
// hand admission only what a source may claim: the id, approval, digest,
// credential slot, and classified effect are dropped here.

import type { CapabilityEffect, CapabilityManifest, CapabilityProviderKind } from '../manifest';
import type {
    CapabilityCandidateV1,
    CapabilityProposalV1,
    LifecycleHint,
    ProposedAuthRequirement,
    ProposedTransport
} from '../provider';
import { ProviderMaterializeError } from '../provider';

export interface ProposalSource {
    providerId: string;
    providerKind: CapabilityProviderKind;
    externalId: string;
    sourceLocator: string;
    sourceRevision?: string;
    discoveredAtMs: number;
    effectHint?: CapabilityEffect;
}

export function proposalFromManifest(manifest: CapabilityManifest, source: ProposalSource): CapabilityProposalV1 {
    const transport = proposedTransport(manifest);
    return {
        version: 1,
        provider: { id: source.providerId, kind: source.providerKind },
        externalIdentity: {
            ...(transport.kind === 'http' ? { origin: new URL(transport.baseUrl).origin } : {}),
            operationId: source.externalId.slice(0, 120),
            sourceLocator: source.sourceLocator.slice(0, 200),
            ...(source.sourceRevision ? { sourceRevision: source.sourceRevision.slice(0, 120) } : {})
        },
        title: manifest.title,
        ...(manifest.description ? { description: manifest.description } : {}),
        ...(source.effectHint ? { effectHint: source.effectHint } : {}),
        auth: proposedAuth(manifest),
        transport,
        inputs: manifest.inputs.map(entry => ({ ...entry })),
        output: { ...manifest.output },
        execution: manifest.execution?.kind === 'async_poll' ? { ...manifest.execution } : { kind: 'sync' },
        provenance: {
            providerId: source.providerId,
            sourceLocator: source.sourceLocator.slice(0, 200),
            discoveredAtMs: source.discoveredAtMs
        }
    };
}

export function candidateFromManifest(
    manifest: CapabilityManifest,
    source: ProposalSource,
    lifecycleHint: LifecycleHint = 'sync'
): CapabilityCandidateV1 {
    return {
        version: 1,
        providerId: source.providerId,
        externalId: source.externalId,
        title: manifest.title,
        ...(manifest.description ? { description: manifest.description } : {}),
        sourceKind: manifest.source.kind,
        ...(manifest.transport.kind === 'http' ? { origin: new URL(manifest.transport.baseUrl).origin } : {}),
        ...(source.effectHint ? { effectHint: source.effectHint } : {}),
        authHint: manifest.auth.kind,
        lifecycleHint,
        provenance: {
            providerId: source.providerId,
            sourceLocator: source.sourceLocator,
            discoveredAtMs: source.discoveredAtMs
        }
    };
}

function proposedTransport(manifest: CapabilityManifest): ProposedTransport {
    const transport = manifest.transport;
    if (transport.kind === 'http') {
        return { kind: 'http', access: transport.access, baseUrl: transport.baseUrl, method: transport.method, path: transport.path };
    }
    if (transport.kind === 'mcp') {
        return { kind: 'mcp', serverId: transport.serverId, toolName: transport.toolName };
    }
    if (transport.kind === 'async') {
        return { kind: 'async', runtimeId: transport.runtimeId, operation: transport.operation };
    }
    throw new ProviderMaterializeError('local transports are host builtins, not provider proposals');
}

function proposedAuth(manifest: CapabilityManifest): ProposedAuthRequirement {
    const auth = manifest.auth;
    if (auth.kind === 'apiKey' && auth.in && auth.name) {
        return { kind: 'apiKey', in: auth.in, name: auth.name, ...(auth.prefix ? { prefix: auth.prefix } : {}) };
    }
    if (auth.kind === 'bearer') return { kind: 'bearer', ...(auth.prefix ? { prefix: auth.prefix } : {}) };
    if (auth.kind === 'basic') return { kind: 'basic' };
    return { kind: 'none' };
}
