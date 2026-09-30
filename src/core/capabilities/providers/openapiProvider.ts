// OpenAPI acquisition. The bounded compiler stays the parser; this provider
// only turns its output into candidates and untrusted proposals.

import { compileOpenApi } from '../openapi';
import type { CapabilityManifest } from '../manifest';
import {
    ProviderMaterializeError,
    type CapabilityProvider
} from '../provider';
import { candidateFromManifest, proposalFromManifest, type ProposalSource } from './fromManifest';

export interface OpenApiDiscoveryRequest {
    document: unknown;
    /** Stamped by discover so materialize reproduces the same provenance. */
    discoveredAtMs?: number;
}

export const OPENAPI_PROVIDER_ID = 'openapi';

function externalIdFor(manifest: CapabilityManifest): string {
    if (manifest.transport.kind !== 'http') return manifest.id;
    return manifest.source.operationId ?? `${manifest.transport.method} ${manifest.transport.path}`;
}

function sourceFor(manifest: CapabilityManifest, request: OpenApiDiscoveryRequest, now: number): ProposalSource {
    const revision = versionOf(request.document);
    return {
        providerId: OPENAPI_PROVIDER_ID,
        providerKind: 'openapi',
        externalId: externalIdFor(manifest),
        sourceLocator: manifest.source.locator,
        ...(revision ? { sourceRevision: revision } : {}),
        discoveredAtMs: request.discoveredAtMs ?? now,
        ...(manifest.effectSource === 'extension' ? { effectHint: manifest.effect } : {})
    };
}

function versionOf(document: unknown): string | undefined {
    if (typeof document !== 'object' || document === null) return undefined;
    const info = (document as { info?: { version?: unknown } }).info;
    return typeof info?.version === 'string' ? info.version : undefined;
}

export const openapiProvider: CapabilityProvider<OpenApiDiscoveryRequest> = {
    id: OPENAPI_PROVIDER_ID,
    kind: 'openapi',

    async discover(request, context) {
        const now = context?.nowMs ?? Date.now();
        const compiled = compileOpenApi(request.document);
        return {
            candidates: compiled.manifests.map(manifest => candidateFromManifest(manifest, sourceFor(manifest, request, now))),
            issues: compiled.errors.map(issue => ({
                ...(issue.operation ? { externalId: issue.operation } : {}),
                message: issue.message
            }))
        };
    },

    async materialize(candidate, context) {
        const compiled = compileOpenApi(context.request.document);
        const matches = compiled.manifests.filter(entry => externalIdFor(entry) === candidate.externalId);
        if (matches.length !== 1) {
            throw new ProviderMaterializeError(`operation ${candidate.externalId} does not name exactly one operation`);
        }
        const manifest = matches[0];
        return proposalFromManifest(
            manifest,
            sourceFor(manifest, context.request, candidate.provenance.discoveredAtMs)
        );
    }
};
