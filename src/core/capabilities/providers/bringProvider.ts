// Manual structured acquisition. A description written by a person or a
// model is the same untrusted proposal as any other source.

import { compileBring, type BringApiDescription } from '../bring';
import type { CapabilityManifest } from '../manifest';
import { ProviderMaterializeError, type CapabilityProvider } from '../provider';
import { candidateFromManifest, proposalFromManifest, type ProposalSource } from './fromManifest';

export interface BringDiscoveryRequest {
    description: BringApiDescription;
    discoveredAtMs?: number;
}

export const BRING_PROVIDER_ID = 'bring';

function externalIdFor(manifest: CapabilityManifest, description: BringApiDescription): string {
    if (typeof description.id === 'string' && description.id.trim()) return description.id.trim();
    return manifest.transport.kind === 'http' ? `${manifest.transport.method} ${manifest.transport.path}` : manifest.id;
}

function sourceFor(manifest: CapabilityManifest, request: BringDiscoveryRequest, now: number): ProposalSource {
    return {
        providerId: BRING_PROVIDER_ID,
        providerKind: 'manual',
        externalId: externalIdFor(manifest, request.description),
        sourceLocator: manifest.source.locator,
        discoveredAtMs: request.discoveredAtMs ?? now,
        ...(manifest.effectSource === 'declared' ? { effectHint: manifest.effect } : {})
    };
}

export const bringProvider: CapabilityProvider<BringDiscoveryRequest> = {
    id: BRING_PROVIDER_ID,
    kind: 'manual',

    async discover(request, context) {
        const now = context?.nowMs ?? Date.now();
        const compiled = compileBring(request.description);
        return {
            candidates: compiled.manifests.map(manifest => candidateFromManifest(manifest, sourceFor(manifest, request, now))),
            issues: compiled.errors.map(issue => ({ message: issue.message }))
        };
    },

    async materialize(candidate, context) {
        const compiled = compileBring(context.request.description);
        const manifest = compiled.manifests[0];
        if (!manifest) throw new ProviderMaterializeError(compiled.errors[0]?.message ?? 'description did not compile');
        const source = sourceFor(manifest, context.request, candidate.provenance.discoveredAtMs);
        if (source.externalId !== candidate.externalId) {
            throw new ProviderMaterializeError('candidate does not match the description');
        }
        return proposalFromManifest(manifest, source);
    }
};
