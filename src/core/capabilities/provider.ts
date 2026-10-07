// CapabilityProvider contract. A provider knows one external ecosystem and
// can only discover candidates and materialize untrusted proposals. It never
// names an id, an effect, an approval, or a credential slot. Admission
// (`admission.ts`) derives those, and installProposal is still the only way a
// proposal becomes an installed manifest.

import type {
    CapabilityEffect,
    CapabilityInput,
    CapabilityOutput,
    CapabilityProviderKind,
    HttpAccess,
    HttpMethod
} from './manifest';

export type { CapabilityProviderKind } from './manifest';

export type LifecycleHint = 'sync' | 'async' | 'event';

export interface CapabilityCandidateV1 {
    version: 1;
    providerId: string;
    externalId: string;
    title: string;
    description?: string;
    sourceKind: string;
    origin?: string;
    effectHint?: CapabilityEffect;
    authHint?: string;
    lifecycleHint?: LifecycleHint;
    provenance: {
        providerId: string;
        sourceLocator: string;
        discoveredAtMs: number;
    };
}

/** Placement only. The slot name is derived by admission from the transport. */
export type ProposedAuthRequirement =
    | { kind: 'none' }
    | { kind: 'apiKey'; in: 'header' | 'query'; name: string; prefix?: string }
    | { kind: 'bearer'; prefix?: string }
    | { kind: 'basic' }
    /** Scopes only. A token enters the slot through a host connect flow, never a proposal. */
    | { kind: 'oauth'; scopes: string[] };

export type ProposedTransport =
    | { kind: 'http'; access: HttpAccess; baseUrl: string; method: HttpMethod; path: string }
    /** `origin` is the server's URL origin; admission keys the credential slot on it, as for an http base. */
    | { kind: 'mcp'; serverId: string; origin: string; toolName: string }
    /** Names a runtime the host binds. The provider cannot supply its endpoint. */
    | { kind: 'async'; runtimeId: string; operation: string };

export type ProposedInput = CapabilityInput;
export type ProposedOutput = CapabilityOutput;

export type ProposedExecutionProfile =
    | { kind: 'sync' }
    | { kind: 'async_poll'; pollIntervalMs: number; maxDurationMs: number };

export interface CapabilityProposalProvenance {
    providerId: string;
    sourceLocator: string;
    discoveredAtMs: number;
}

export interface CapabilityProposalV1 {
    version: 1;
    provider: {
        id: string;
        kind: CapabilityProviderKind;
    };
    externalIdentity: {
        origin?: string;
        operationId: string;
        sourceLocator: string;
        sourceRevision?: string;
    };
    title: string;
    description?: string;
    /** A hint. Admission may raise it to the transport floor and refuses a hint below it. */
    effectHint?: CapabilityEffect;
    auth: ProposedAuthRequirement;
    transport: ProposedTransport;
    inputs: ProposedInput[];
    output: ProposedOutput;
    execution: ProposedExecutionProfile;
    provenance: CapabilityProposalProvenance;
}

export interface CapabilityDiscoveryContext {
    nowMs?: number;
}

export interface CapabilityMaterializationContext<TRequest> {
    /** The same request discover saw. Providers re-derive; they keep no hidden state. */
    request: TRequest;
}

export interface ProviderIssue {
    externalId?: string;
    message: string;
}

export interface CapabilityDiscovery {
    candidates: CapabilityCandidateV1[];
    /** What the source offered that the provider could not represent. */
    issues: ProviderIssue[];
}

export interface CapabilityProvider<TRequest = unknown> {
    readonly id: string;
    readonly kind: CapabilityProviderKind;
    discover(request: TRequest, context?: CapabilityDiscoveryContext): Promise<CapabilityDiscovery>;
    materialize(
        candidate: CapabilityCandidateV1,
        context: CapabilityMaterializationContext<TRequest>
    ): Promise<CapabilityProposalV1>;
}

export class ProviderMaterializeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProviderMaterializeError';
    }
}
