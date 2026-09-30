// The host gate between a provider's proposal and an installed manifest.
// Everything a provider could use to grant itself authority is derived here:
// id from the transport, effect from the transport floor plus host trust,
// approval from the effect, and the credential slot from the destination.
// The result still goes through validateManifest and installProposal.

import { canonicalCapabilityId, transportCredentialSlot } from './identity';
import {
    approvalForEffect,
    canonicalInput,
    canonicalOutput,
    canonicalScopes,
    effectAllowedForMethod,
    effectForMethod,
    isRecord,
    PROVIDER_ID_PATTERN,
    schemaDigestFor,
    sealManifest,
    validateManifest,
    type AuthBinding,
    type CapabilityEffect,
    type CapabilityProviderKind,
    type CapabilitySourceKind,
    type CapabilityTransport,
    type EffectSource,
    type ManifestDraft,
    type ManifestValidation
} from './manifest';
import { installProposal, type InstallResult } from './registry';
import type { CapabilityProposalV1, ProposedAuthRequirement, ProposedTransport } from './provider';

export interface AdmissionPolicy {
    /**
     * Host-owned trust list. Only a server named here may have its read hint
     * accepted. Nothing a provider returns can add to it.
     */
    trustedEffectHints?: {
        mcpServers?: readonly string[];
        asyncRuntimes?: readonly string[];
    };
    nowMs?: number;
}

const PROPOSAL_KEYS = new Set([
    'version', 'provider', 'externalIdentity', 'title', 'description', 'effectHint',
    'auth', 'transport', 'inputs', 'output', 'execution', 'provenance'
]);
const PROVIDER_KEYS = new Set(['id', 'kind']);
const IDENTITY_KEYS = new Set(['origin', 'operationId', 'sourceLocator', 'sourceRevision']);
const AUTH_KEYS = new Set(['kind', 'in', 'name', 'prefix', 'scopes']);
const HTTP_TRANSPORT_KEYS = new Set(['kind', 'access', 'baseUrl', 'method', 'path']);
const MCP_TRANSPORT_KEYS = new Set(['kind', 'serverId', 'toolName']);
const ASYNC_TRANSPORT_KEYS = new Set(['kind', 'runtimeId', 'operation']);
const SYNC_EXECUTION_KEYS = new Set(['kind']);
const ASYNC_EXECUTION_KEYS = new Set(['kind', 'pollIntervalMs', 'maxDurationMs']);
const PROVENANCE_KEYS = new Set(['providerId', 'sourceLocator', 'discoveredAtMs']);
const INPUT_KEYS = new Set(['name', 'in', 'required', 'schema']);
const OUTPUT_KEYS = new Set(['schema', 'itemsPath', 'titlePath', 'presentation']);
const EFFECTS: CapabilityEffect[] = ['read', 'compute', 'write', 'destructive'];

const SOURCE_KIND_FOR: Partial<Record<CapabilityProviderKind, CapabilitySourceKind>> = {
    openapi: 'openapi',
    mcp: 'mcp',
    manual: 'bring',
    web_data: 'web_data',
    managed_integration: 'managed_integration'
};

/** Build the manifest a proposal would become. Nothing is installed. */
export function manifestFromProposal(proposal: unknown, policy: AdmissionPolicy = {}): ManifestValidation {
    const errors = shapeErrors(proposal);
    if (errors.length > 0) return { ok: false, errors };
    const typed = proposal as CapabilityProposalV1;

    const sourceKind = SOURCE_KIND_FOR[typed.provider.kind];
    if (!sourceKind) return { ok: false, errors: [`provider kind ${typed.provider.kind} has no admission path`] };

    const transport = hostTransport(typed.transport);
    if ('error' in transport) return { ok: false, errors: [transport.error] };

    const effect = hostEffect(typed, transport.transport, policy);
    if ('error' in effect) return { ok: false, errors: [effect.error] };

    const auth = hostAuth(typed.auth, transport.transport);
    if ('error' in auth) return { ok: false, errors: [auth.error] };

    const inputs = typed.inputs.map(canonicalInput);
    const output = canonicalOutput(typed.output);
    const draft: ManifestDraft = {
        version: 1,
        id: canonicalCapabilityId(transport.transport),
        title: typed.title,
        ...(typed.description ? { description: typed.description } : {}),
        source: {
            kind: sourceKind,
            locator: typed.externalIdentity.sourceLocator,
            operationId: typed.externalIdentity.operationId
        },
        provenance: {
            providerId: typed.provider.id,
            providerKind: typed.provider.kind,
            externalId: typed.externalIdentity.operationId,
            sourceLocator: typed.externalIdentity.sourceLocator,
            ...(typed.externalIdentity.sourceRevision ? { sourceRevision: typed.externalIdentity.sourceRevision } : {}),
            discoveredAtMs: typed.provenance.discoveredAtMs,
            admittedAtMs: policy.nowMs ?? Date.now(),
            schemaDigest: schemaDigestFor({ inputs, output })
        },
        effect: effect.effect,
        effectSource: effect.source,
        approval: approvalForEffect(effect.effect),
        invocation: 'manual',
        trigger: { kind: 'manual' },
        auth: auth.auth,
        transport: transport.transport,
        ...(typed.execution.kind === 'async_poll'
            ? {
                execution: {
                    kind: 'async_poll' as const,
                    pollIntervalMs: typed.execution.pollIntervalMs,
                    maxDurationMs: typed.execution.maxDurationMs
                }
            }
            : {}),
        inputs,
        output
    };
    return validateManifest(sealManifest(draft));
}

/** The only provider-facing install path. Side effects still land as `pending`. */
export function admitProposal(proposal: unknown, policy: AdmissionPolicy = {}): InstallResult {
    const built = manifestFromProposal(proposal, policy);
    if (!built.ok || !built.manifest) return { ok: false, errors: built.errors };
    return installProposal(built.manifest);
}

function hostTransport(transport: ProposedTransport): { transport: CapabilityTransport } | { error: string } {
    if (transport.kind === 'http') {
        return {
            transport: {
                kind: 'http',
                access: transport.access,
                baseUrl: transport.baseUrl,
                method: transport.method,
                path: transport.path
            }
        };
    }
    if (transport.kind === 'mcp') {
        return { transport: { kind: 'mcp', serverId: transport.serverId, toolName: transport.toolName } };
    }
    if (transport.kind === 'async') {
        return { transport: { kind: 'async', runtimeId: transport.runtimeId, operation: transport.operation } };
    }
    return { error: 'providers may propose http, mcp, or async transports only' };
}

function hostEffect(
    proposal: CapabilityProposalV1,
    transport: CapabilityTransport,
    policy: AdmissionPolicy
): { effect: CapabilityEffect; source: EffectSource } | { error: string } {
    const hint = proposal.effectHint;
    if (transport.kind === 'http') {
        if (hint === undefined) return { effect: effectForMethod(transport.method), source: 'method' };
        if (!effectAllowedForMethod(transport.method, hint)) {
            return { error: `${transport.method} cannot be declared ${hint}` };
        }
        return { effect: hint, source: proposal.provider.kind === 'openapi' ? 'extension' : 'declared' };
    }
    if (transport.kind === 'mcp' || transport.kind === 'async') {
        // No method floor exists here, so an untrusted source lands at write.
        const trusted = transport.kind === 'mcp'
            ? policy.trustedEffectHints?.mcpServers?.includes(transport.serverId) === true
            : policy.trustedEffectHints?.asyncRuntimes?.includes(transport.runtimeId) === true;
        const source: EffectSource = trusted ? 'annotation' : 'declared';
        if (hint === 'destructive') return { effect: 'destructive', source };
        if (trusted && hint === 'read') return { effect: 'read', source };
        return { effect: 'write', source };
    }
    return { error: 'transport has no effect floor' };
}

function hostAuth(auth: ProposedAuthRequirement, transport: CapabilityTransport): { auth: AuthBinding } | { error: string } {
    if (auth.kind === 'none') return { auth: { kind: 'none' } };
    const placement = {
        kind: auth.kind,
        ...(auth.kind === 'apiKey' ? { in: auth.in, name: auth.name } : {}),
        ...(auth.kind === 'oauth' ? { scopes: canonicalScopes(auth.scopes) } : {})
    } as Pick<AuthBinding, 'kind' | 'in' | 'name' | 'scopes'>;
    const secretRef = transportCredentialSlot(transport, placement);
    if (!secretRef) return { error: `${transport.kind} transports cannot bind a credential slot` };
    return {
        auth: {
            ...placement,
            ...('prefix' in auth && auth.prefix ? { prefix: auth.prefix } : {}),
            secretRef
        }
    };
}

function shapeErrors(input: unknown): string[] {
    const errors: string[] = [];
    if (!isRecord(input)) return ['proposal must be an object'];
    closed(input, PROPOSAL_KEYS, 'proposal', errors, {
        approval: 'approval is host-owned',
        effect: 'effect is classified by admission; send effectHint',
        id: 'capability ids are derived from the transport',
        digest: 'the digest is sealed by admission',
        trusted: 'trust is a host policy'
    });
    if (input.version !== 1) errors.push('proposal.version must be 1');

    if (!isRecord(input.provider)) {
        errors.push('proposal.provider is required');
    } else {
        closed(input.provider, PROVIDER_KEYS, 'proposal.provider', errors);
        if (typeof input.provider.id !== 'string' || !PROVIDER_ID_PATTERN.test(input.provider.id)) {
            errors.push('proposal.provider.id is invalid');
        }
        if (typeof input.provider.kind !== 'string') errors.push('proposal.provider.kind is invalid');
    }

    if (!isRecord(input.externalIdentity)) {
        errors.push('proposal.externalIdentity is required');
    } else {
        const identity = input.externalIdentity;
        closed(identity, IDENTITY_KEYS, 'proposal.externalIdentity', errors);
        if (typeof identity.operationId !== 'string' || identity.operationId.length === 0 || identity.operationId.length > 120) {
            errors.push('proposal.externalIdentity.operationId must be a short non-empty string');
        }
        if (typeof identity.sourceLocator !== 'string' || identity.sourceLocator.length === 0 || identity.sourceLocator.length > 200) {
            errors.push('proposal.externalIdentity.sourceLocator must be a short non-empty string');
        }
        if (identity.sourceRevision !== undefined && (typeof identity.sourceRevision !== 'string' || identity.sourceRevision.length > 120)) {
            errors.push('proposal.externalIdentity.sourceRevision must be a short string');
        }
        if (identity.origin !== undefined && typeof identity.origin !== 'string') {
            errors.push('proposal.externalIdentity.origin must be a string');
        }
    }

    if (input.effectHint !== undefined && !EFFECTS.includes(input.effectHint as CapabilityEffect)) {
        errors.push('proposal.effectHint is invalid');
    }

    if (!isRecord(input.auth)) {
        errors.push('proposal.auth is required');
    } else {
        closed(input.auth, AUTH_KEYS, 'proposal.auth', errors, {
            secretRef: 'credential slots are derived by admission',
            token: 'tokens are bound to a slot by the host, never proposed',
            accessToken: 'tokens are bound to a slot by the host, never proposed',
            refreshToken: 'tokens are bound to a slot by the host, never proposed'
        });
        const kind = input.auth.kind;
        if (kind !== 'none' && kind !== 'apiKey' && kind !== 'bearer' && kind !== 'basic' && kind !== 'oauth') {
            errors.push('proposal.auth.kind is invalid');
        }
        if (kind === 'oauth' && !Array.isArray(input.auth.scopes)) errors.push('proposal.auth.scopes is required for oauth');
        if (kind !== 'oauth' && input.auth.scopes !== undefined) errors.push('proposal.auth.scopes is only for oauth');
    }

    if (!isRecord(input.transport)) {
        errors.push('proposal.transport is required');
    } else if (input.transport.kind === 'http') {
        closed(input.transport, HTTP_TRANSPORT_KEYS, 'proposal.transport', errors);
        if (isRecord(input.externalIdentity) && typeof input.externalIdentity.origin === 'string') {
            const origin = originOf(input.transport.baseUrl);
            if (origin !== input.externalIdentity.origin) {
                errors.push('proposal.externalIdentity.origin does not match the transport');
            }
        }
    } else if (input.transport.kind === 'mcp') {
        closed(input.transport, MCP_TRANSPORT_KEYS, 'proposal.transport', errors);
    } else if (input.transport.kind === 'async') {
        closed(input.transport, ASYNC_TRANSPORT_KEYS, 'proposal.transport', errors, {
            baseUrl: 'async endpoints are bound by the host runtime',
            url: 'async endpoints are bound by the host runtime'
        });
        if (isRecord(input.externalIdentity) && input.externalIdentity.origin !== undefined) {
            errors.push('proposal.externalIdentity.origin is not used by async transports');
        }
    } else {
        errors.push('providers may propose http, mcp, or async transports only');
    }

    if (!Array.isArray(input.inputs)) {
        errors.push('proposal.inputs must be a list');
    } else {
        for (const entry of input.inputs) {
            if (!isRecord(entry)) errors.push('each proposal input must be an object');
            else closed(entry, INPUT_KEYS, `proposal.inputs.${String(entry.name)}`, errors);
        }
    }
    if (!isRecord(input.output)) {
        errors.push('proposal.output is required');
    } else {
        closed(input.output, OUTPUT_KEYS, 'proposal.output', errors);
        if (containsAny(input.output.schema)) {
            errors.push('proposal.output.schema must be typed; an untyped result is not admitted as any');
        }
    }

    if (!isRecord(input.execution)) {
        errors.push('proposal.execution is required');
    } else {
        const kind = input.execution.kind;
        if (kind === 'sync') closed(input.execution, SYNC_EXECUTION_KEYS, 'proposal.execution', errors);
        else if (kind === 'async_poll') closed(input.execution, ASYNC_EXECUTION_KEYS, 'proposal.execution', errors);
        else errors.push('proposal.execution.kind is not supported');
        const asyncTransport = isRecord(input.transport) && input.transport.kind === 'async';
        if (asyncTransport !== (kind === 'async_poll')) {
            errors.push('proposal.execution must be async_poll exactly when the transport is async');
        }
    }

    if (!isRecord(input.provenance)) {
        errors.push('proposal.provenance is required');
    } else {
        closed(input.provenance, PROVENANCE_KEYS, 'proposal.provenance', errors);
        if (isRecord(input.provider) && input.provenance.providerId !== input.provider.id) {
            errors.push('proposal.provenance.providerId must match proposal.provider.id');
        }
        if (isRecord(input.externalIdentity) && input.provenance.sourceLocator !== input.externalIdentity.sourceLocator) {
            errors.push('proposal.provenance.sourceLocator must match the external identity');
        }
        const at = input.provenance.discoveredAtMs;
        if (typeof at !== 'number' || !Number.isInteger(at) || at < 0) {
            errors.push('proposal.provenance.discoveredAtMs must be a timestamp');
        }
    }
    return errors;
}

function closed(
    record: Record<string, unknown>,
    allowed: Set<string>,
    path: string,
    errors: string[],
    reasons: Record<string, string> = {}
): void {
    for (const key of Object.keys(record)) {
        if (allowed.has(key)) continue;
        errors.push(`${path}.${key} is not a proposal field${reasons[key] ? `; ${reasons[key]}` : ''}`);
    }
}

function containsAny(schema: unknown, depth = 0): boolean {
    if (!isRecord(schema) || depth > 32) return false;
    if (schema.kind === 'any') return true;
    if (containsAny(schema.items, depth + 1)) return true;
    if (isRecord(schema.additionalProperties) && containsAny(schema.additionalProperties, depth + 1)) return true;
    return isRecord(schema.properties)
        && Object.values(schema.properties).some(child => containsAny(child, depth + 1));
}

function originOf(baseUrl: unknown): string | undefined {
    if (typeof baseUrl !== 'string') return undefined;
    try {
        return new URL(baseUrl).origin;
    } catch {
        return undefined;
    }
}
