// CapabilityManifest is the authoritative description of one callable.
// Compilers may propose one. validateManifest is what makes it real:
// a digest mismatch, an embedded secret, or an illegal effect/approval
// pair is rejected before anything is registered.

import { canonicalize, sha256 } from './hash';
import { canonicalCapabilityId, credentialSlot, transportCredentialSlot } from './identity';
import { validateValueType, type ValueType } from './valueType';

export const CAPABILITY_MANIFEST_VERSION = 1 as const;

export type CapabilityEffect = 'read' | 'compute' | 'write' | 'destructive';
export type CapabilityApproval = 'auto' | 'pending' | 'approved' | 'denied';
export type CapabilitySourceKind = 'openapi' | 'mcp' | 'bring' | 'web_data' | 'managed_integration';
export type CapabilityInvocation = 'auto' | 'manual';
export type CapabilityTrigger =
    | { kind: 'manual' }
    | { kind: 'on_create' }
    | { kind: 'on_input_change' }
    | { kind: 'interval'; everyMs: number };
export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type InputLocation = 'path' | 'query' | 'header' | 'body' | 'argument';
export type EffectSource = 'method' | 'extension' | 'annotation' | 'declared';

export interface CapabilitySource {
    kind: CapabilitySourceKind;
    locator: string;
    operationId?: string;
}

export interface AuthBinding {
    kind: 'none' | 'apiKey' | 'bearer' | 'basic' | 'oauth';
    in?: 'header' | 'query';
    name?: string;
    prefix?: string;
    /**
     * oauth only: the scopes the token in the slot must carry. The slot holds
     * a token the host bound after a connect flow; the manifest never does.
     */
    scopes?: string[];
    /** Slot name. The secret value is never stored on the manifest. */
    secretRef?: string;
}

export interface CapabilityInput {
    name: string;
    in: InputLocation;
    required: boolean;
    schema: ValueType;
}

export interface CapabilityOutput {
    schema: ValueType;
    /** Dot path used only when projecting to the OmniData envelope. */
    itemsPath?: string;
    titlePath?: string;
    presentation: 'items' | 'content' | 'raw';
}

export type HttpAccess = 'browser_direct' | 'server_broker';

export type CapabilityTransport =
    | { kind: 'http'; access: HttpAccess; baseUrl: string; method: HttpMethod; path: string }
    | { kind: 'mcp'; serverId: string; toolName: string }
    | { kind: 'local'; handler: string }
    /** A host-bound job runtime: start returns an external run id, poll observes it. */
    | { kind: 'async'; runtimeId: string; operation: string };

export const MIN_POLL_INTERVAL_MS = 1_000;
export const MAX_POLL_INTERVAL_MS = 300_000;
export const MAX_ASYNC_DURATION_MS = 3_600_000;

/** How an admitted capability completes. Absent means synchronous. */
export type CapabilityExecutionProfile =
    | { kind: 'sync' }
    | { kind: 'async_poll'; pollIntervalMs: number; maxDurationMs: number };

export type CapabilityProviderKind = 'openapi' | 'mcp' | 'managed_integration' | 'web_data' | 'manual';

/**
 * Where an admitted capability came from. Written by admission, never by a
 * provider. Part of the digest, so a stored manifest cannot swap its origin
 * story without failing validation.
 */
export interface CapabilityProvenance {
    providerId: string;
    providerKind: CapabilityProviderKind;
    externalId: string;
    sourceLocator: string;
    sourceRevision?: string;
    discoveredAtMs: number;
    admittedAtMs: number;
    /** SHA-256 of the canonical inputs and output schema. */
    schemaDigest: string;
}

export interface CapabilityManifest {
    version: typeof CAPABILITY_MANIFEST_VERSION;
    id: string;
    title: string;
    description?: string;
    source: CapabilitySource;
    provenance?: CapabilityProvenance;
    effect: CapabilityEffect;
    effectSource: EffectSource;
    approval: CapabilityApproval;
    /**
     * Derived from `trigger`. `manual` waits for the user. Anything else is
     * a schedule the trigger runner owns. Mounting a view is not a trigger.
     */
    invocation?: CapabilityInvocation;
    /** When this capability may run. Write and destructive stay manual. */
    trigger?: CapabilityTrigger;
    auth: AuthBinding;
    transport: CapabilityTransport;
    execution?: CapabilityExecutionProfile;
    inputs: CapabilityInput[];
    output: CapabilityOutput;
    /** SHA-256 of the canonical execution identity. Approval is excluded. */
    digest: string;
}

export type ManifestDraft = Omit<CapabilityManifest, 'digest'>;

const EFFECTS: CapabilityEffect[] = ['read', 'compute', 'write', 'destructive'];
const APPROVALS: CapabilityApproval[] = ['auto', 'pending', 'approved', 'denied'];
const METHODS: HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const LOCATIONS: InputLocation[] = ['path', 'query', 'header', 'body', 'argument'];
const EFFECT_SOURCES: EffectSource[] = ['method', 'extension', 'annotation', 'declared'];
const SOURCE_KINDS: CapabilitySourceKind[] = ['openapi', 'mcp', 'bring', 'web_data', 'managed_integration'];

const PROVIDER_KINDS: CapabilityProviderKind[] = ['openapi', 'mcp', 'managed_integration', 'web_data', 'manual'];

const MANIFEST_KEYS = new Set([
    'version', 'id', 'title', 'description', 'source', 'provenance', 'effect', 'effectSource',
    'approval', 'invocation', 'trigger', 'auth', 'transport', 'execution', 'inputs', 'output', 'digest'
]);

const RUNTIME_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_OAUTH_SCOPES = 20;
/** Each input schema is already depth-bounded by validateValueType. */
export const MAX_MANIFEST_INPUTS = 64;
const OAUTH_SCOPE_PATTERN = /^[\x21\x23-\x5B\x5D-\x7E]{1,200}$/;
const OPERATION_PATTERN = /^[A-Za-z0-9_.:-]{1,120}$/;

const PROVENANCE_KEYS = new Set([
    'providerId', 'providerKind', 'externalId', 'sourceLocator', 'sourceRevision',
    'discoveredAtMs', 'admittedAtMs', 'schemaDigest'
]);

export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_.:-]{0,63}$/;

const ID_PATTERN = /^cap_[a-z0-9_]{1,80}$/;
const SECRET_REF_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,64}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function effectForMethod(method: HttpMethod): CapabilityEffect {
    if (method === 'GET' || method === 'HEAD') return 'read';
    if (method === 'DELETE') return 'destructive';
    return 'write';
}

export function approvalForEffect(effect: CapabilityEffect): CapabilityApproval {
    return effect === 'read' || effect === 'compute' ? 'auto' : 'pending';
}

/**
 * Method is the floor. An imported spec may raise the effect
 * (GET marked destructive needs approval) and may not lower it
 * (POST marked compute does not become auto).
 */
export function effectAllowedForMethod(method: HttpMethod, effect: CapabilityEffect): boolean {
    if (method === 'GET' || method === 'HEAD') return true;
    if (method === 'DELETE') return effect === 'destructive';
    return effect === 'write' || effect === 'destructive';
}

export const MIN_TRIGGER_INTERVAL_MS = 5_000;
export const MAX_TRIGGER_INTERVAL_MS = 86_400_000;

export function normalizeTrigger(trigger: CapabilityTrigger | undefined, invocation?: CapabilityInvocation): CapabilityTrigger {
    if (trigger && validTriggerShape(trigger)) return trigger;
    if (invocation === 'auto') return { kind: 'on_create' };
    return { kind: 'manual' };
}

export function triggerInvocation(trigger: CapabilityTrigger): CapabilityInvocation {
    return trigger.kind === 'manual' ? 'manual' : 'auto';
}

function validTriggerShape(trigger: CapabilityTrigger): boolean {
    if (trigger.kind === 'manual' || trigger.kind === 'on_create' || trigger.kind === 'on_input_change') return true;
    if (trigger.kind === 'interval') return Number.isInteger(trigger.everyMs);
    return false;
}

export function triggerProblem(effect: CapabilityEffect, trigger: CapabilityTrigger): string | null {
    if ((effect === 'write' || effect === 'destructive') && trigger.kind !== 'manual') {
        return 'write and destructive capabilities only run manually';
    }
    if (trigger.kind === 'interval' && (
        !Number.isInteger(trigger.everyMs)
        || trigger.everyMs < MIN_TRIGGER_INTERVAL_MS
        || trigger.everyMs > MAX_TRIGGER_INTERVAL_MS
    )) {
        return `interval must be between ${MIN_TRIGGER_INTERVAL_MS} and ${MAX_TRIGGER_INTERVAL_MS} ms`;
    }
    return null;
}

/** Digest of the typed contract alone: inputs and output schema. */
export function schemaDigestFor(draft: Pick<ManifestDraft, 'inputs' | 'output'>): string {
    return sha256(canonicalize({ inputs: draft.inputs, output: draft.output }));
}

export function digestPayload(draft: ManifestDraft): unknown {
    return {
        version: draft.version,
        id: draft.id,
        title: draft.title,
        description: draft.description ?? null,
        source: draft.source,
        // Absent on manifests that predate providers, so their digests do not move.
        ...(draft.provenance ? { provenance: draft.provenance } : {}),
        effect: draft.effect,
        effectSource: draft.effectSource,
        invocation: triggerInvocation(normalizeTrigger(draft.trigger, draft.invocation)),
        trigger: normalizeTrigger(draft.trigger, draft.invocation),
        auth: draft.auth,
        transport: draft.transport,
        ...(isAsyncProfile(draft.execution) ? { execution: draft.execution } : {}),
        inputs: draft.inputs,
        output: draft.output
    };
}

function isAsyncProfile(profile: CapabilityExecutionProfile | undefined): profile is Extract<CapabilityExecutionProfile, { kind: 'async_poll' }> {
    return profile?.kind === 'async_poll';
}

export function sealManifest(draft: ManifestDraft): CapabilityManifest {
    const trigger = normalizeTrigger(draft.trigger, draft.invocation);
    const invocation = triggerInvocation(trigger);
    const body = { ...draft, invocation, trigger } as ManifestDraft;
    return {
        ...body,
        digest: sha256(canonicalize(digestPayload(body)))
    };
}

function validateAuth(auth: unknown, errors: string[]): void {
    if (!isRecord(auth)) {
        errors.push('auth must be an object');
        return;
    }
    const allowed = new Set(['kind', 'in', 'name', 'prefix', 'secretRef', 'scopes']);
    for (const key of Object.keys(auth)) {
        if (!allowed.has(key)) errors.push(`auth.${key} is not a manifest field`);
    }
    const kind = auth.kind;
    if (kind !== 'none' && kind !== 'apiKey' && kind !== 'bearer' && kind !== 'basic' && kind !== 'oauth') {
        errors.push('auth.kind is invalid');
        return;
    }
    if (kind === 'oauth') {
        if (auth.in !== undefined || auth.name !== undefined || auth.prefix !== undefined) {
            errors.push('oauth auth is sent as a bearer token and carries no placement');
        }
        const scopes = auth.scopes;
        if (!Array.isArray(scopes) || scopes.length === 0 || scopes.length > MAX_OAUTH_SCOPES
            || !scopes.every(scope => typeof scope === 'string' && OAUTH_SCOPE_PATTERN.test(scope))) {
            errors.push(`oauth auth requires 1 to ${MAX_OAUTH_SCOPES} scopes`);
        }
    } else if (auth.scopes !== undefined) {
        errors.push('only oauth auth carries scopes');
    }
    if (kind === 'none') {
        if (auth.secretRef || auth.name || auth.prefix || auth.in) {
            errors.push('auth.kind none cannot carry placement or a secretRef');
        }
        return;
    }
    if (typeof auth.secretRef !== 'string' || !SECRET_REF_PATTERN.test(auth.secretRef)) {
        errors.push('auth.secretRef must be a slot name, not a secret');
    }
    if (kind === 'apiKey') {
        if (auth.in !== 'header' && auth.in !== 'query') errors.push('apiKey auth requires in: header or query');
        if (typeof auth.name !== 'string' || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,64}$/.test(auth.name)) {
            errors.push('apiKey auth requires a header or query name');
        }
    }
    if (auth.prefix !== undefined && (typeof auth.prefix !== 'string' || auth.prefix.length > 32)) {
        errors.push('auth.prefix must be a short string');
    }
}

function validateExecution(execution: unknown, transportKind: unknown, errors: string[]): void {
    const async = transportKind === 'async';
    if (execution === undefined || (isRecord(execution) && execution.kind === 'sync' && Object.keys(execution).length === 1)) {
        if (async) errors.push('async transports need an async_poll execution profile');
        return;
    }
    if (!isRecord(execution) || execution.kind !== 'async_poll') {
        errors.push('execution must be sync or async_poll');
        return;
    }
    for (const key of Object.keys(execution)) {
        if (key !== 'kind' && key !== 'pollIntervalMs' && key !== 'maxDurationMs') errors.push(`execution.${key} is not a manifest field`);
    }
    if (!async) errors.push('async_poll needs an async transport');
    const interval = execution.pollIntervalMs;
    const duration = execution.maxDurationMs;
    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < MIN_POLL_INTERVAL_MS || interval > MAX_POLL_INTERVAL_MS) {
        errors.push(`execution.pollIntervalMs must be between ${MIN_POLL_INTERVAL_MS} and ${MAX_POLL_INTERVAL_MS} ms`);
    }
    if (
        typeof duration !== 'number' || !Number.isInteger(duration)
        || duration > MAX_ASYNC_DURATION_MS
        || (typeof interval === 'number' && duration < interval)
    ) {
        errors.push(`execution.maxDurationMs must be at least one poll interval and at most ${MAX_ASYNC_DURATION_MS} ms`);
    }
}

function validateProvenance(provenance: unknown, errors: string[]): void {
    if (!isRecord(provenance)) {
        errors.push('provenance must be an object');
        return;
    }
    for (const key of Object.keys(provenance)) {
        if (!PROVENANCE_KEYS.has(key)) errors.push(`provenance.${key} is not a provenance field`);
    }
    if (typeof provenance.providerId !== 'string' || !PROVIDER_ID_PATTERN.test(provenance.providerId)) {
        errors.push('provenance.providerId is invalid');
    }
    if (typeof provenance.providerKind !== 'string' || !PROVIDER_KINDS.includes(provenance.providerKind as CapabilityProviderKind)) {
        errors.push('provenance.providerKind is invalid');
    }
    for (const key of ['externalId', 'sourceLocator'] as const) {
        const value = provenance[key];
        if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
            errors.push(`provenance.${key} must be a short non-empty string`);
        }
    }
    if (provenance.sourceRevision !== undefined && (typeof provenance.sourceRevision !== 'string' || provenance.sourceRevision.length > 120)) {
        errors.push('provenance.sourceRevision must be a short string');
    }
    for (const key of ['discoveredAtMs', 'admittedAtMs'] as const) {
        const value = provenance[key];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            errors.push(`provenance.${key} must be a timestamp`);
        }
    }
    if (typeof provenance.schemaDigest !== 'string' || !/^[a-f0-9]{64}$/.test(provenance.schemaDigest)) {
        errors.push('provenance.schemaDigest must be a sha256 hex string');
    }
}

function validateHttpUrl(baseUrl: string, errors: string[]): void {
    let url: URL;
    try {
        url = new URL(baseUrl);
    } catch {
        errors.push('transport.baseUrl is not a URL');
        return;
    }
    if (url.username || url.password) {
        errors.push('transport.baseUrl must not embed credentials');
    }
    const host = url.hostname.toLowerCase();
    if (host === '169.254.169.254' || host === 'metadata.google.internal') {
        errors.push('transport.baseUrl targets a metadata service');
    }
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (url.protocol === 'http:' && !loopback) {
        errors.push('transport.baseUrl must be https, except loopback http');
    } else if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('transport.baseUrl must be http or https');
    }
}

function pathParamNames(path: string): string[] {
    return [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
}

export interface ManifestValidation {
    ok: boolean;
    manifest?: CapabilityManifest;
    errors: string[];
}

export function validateManifest(input: unknown): ManifestValidation {
    const errors: string[] = [];
    if (!isRecord(input)) return { ok: false, errors: ['manifest must be an object'] };

    for (const key of Object.keys(input)) {
        if (!MANIFEST_KEYS.has(key)) {
            errors.push(`manifest.${key} is not a manifest field; secrets stay in the secret store`);
        }
    }

    if (input.version !== CAPABILITY_MANIFEST_VERSION) errors.push('version must be 1');
    if (typeof input.id !== 'string' || !ID_PATTERN.test(input.id)) {
        errors.push('id must match cap_[a-z0-9_]');
    }
    if (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 120) {
        errors.push('title must be a short non-empty string');
    }
    if (input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 2000)) {
        errors.push('description must be a short string');
    }
    if (typeof input.effect !== 'string' || !EFFECTS.includes(input.effect as CapabilityEffect)) {
        errors.push('effect is invalid');
    }
    if (typeof input.effectSource !== 'string' || !EFFECT_SOURCES.includes(input.effectSource as EffectSource)) {
        errors.push('effectSource is invalid');
    }
    if (typeof input.approval !== 'string' || !APPROVALS.includes(input.approval as CapabilityApproval)) {
        errors.push('approval is invalid');
    }

    const effect = input.effect as CapabilityEffect;
    const approval = input.approval as CapabilityApproval;
    if (EFFECTS.includes(effect) && APPROVALS.includes(approval)) {
        const sideEffect = effect === 'write' || effect === 'destructive';
        if (sideEffect && approval === 'auto') {
            errors.push(`${effect} capabilities cannot be auto-approved`);
        }
        if (!sideEffect && approval !== 'auto') {
            errors.push(`${effect} capabilities are auto-approved and cannot carry a side-effect approval`);
        }
    }

    if (!isRecord(input.source) || !SOURCE_KINDS.includes(input.source.kind as CapabilitySourceKind)) {
        errors.push('source.kind is invalid');
    } else {
        if (typeof input.source.locator !== 'string' || input.source.locator.length === 0 || input.source.locator.length > 200) {
            errors.push('source.locator is required');
        }
        if (input.source.operationId !== undefined && (typeof input.source.operationId !== 'string' || input.source.operationId.length > 120)) {
            errors.push('source.operationId must be a short string');
        }
    }

    if (input.provenance !== undefined) validateProvenance(input.provenance, errors);

    validateAuth(input.auth, errors);

    if (input.invocation !== undefined && input.invocation !== 'auto' && input.invocation !== 'manual') {
        errors.push('invocation must be auto or manual');
    }
    const trigger = normalizeTrigger(
        input.trigger as CapabilityTrigger | undefined,
        input.invocation === 'auto' ? 'auto' : input.invocation === 'manual' ? 'manual' : undefined
    );
    if (input.trigger !== undefined && !validTriggerShape(input.trigger as CapabilityTrigger)) {
        errors.push('trigger is invalid');
    }
    if (EFFECTS.includes(effect)) {
        const triggerError = triggerProblem(effect, trigger);
        if (triggerError) errors.push(triggerError);
        if (isRecord(input.transport) && input.transport.kind === 'async' && trigger.kind !== 'manual') {
            errors.push('async capabilities only run manually; each run starts an external job');
        }
        if ((effect === 'write' || effect === 'destructive') && isRecord(input.transport) && input.transport.access === 'server_broker') {
            errors.push('server_broker cannot carry a write or destructive effect');
        }
    }
    if (isRecord(input.auth) && input.auth.kind === 'oauth' && isRecord(input.transport)) {
        if (input.transport.kind !== 'http') errors.push('oauth auth is only defined for http transports');
        else if (input.transport.access === 'server_broker') errors.push('server_broker cannot carry an oauth token');
    }

    if (
        !isRecord(input.transport)
        || (input.transport.kind !== 'http' && input.transport.kind !== 'mcp' && input.transport.kind !== 'local' && input.transport.kind !== 'async')
    ) {
        errors.push('transport.kind must be http, mcp, local, or async');
    } else if (input.transport.kind === 'async') {
        if (typeof input.transport.runtimeId !== 'string' || !RUNTIME_ID_PATTERN.test(input.transport.runtimeId)) {
            errors.push('transport.runtimeId is invalid');
        }
        if (typeof input.transport.operation !== 'string' || !OPERATION_PATTERN.test(input.transport.operation)) {
            errors.push('transport.operation is invalid');
        }
    } else if (input.transport.kind === 'http') {
        if (typeof input.transport.baseUrl !== 'string') errors.push('transport.baseUrl is required');
        else validateHttpUrl(input.transport.baseUrl, errors);
        if (typeof input.transport.method !== 'string' || !METHODS.includes(input.transport.method as HttpMethod)) {
            errors.push('transport.method is invalid');
        }
        if (input.transport.access !== 'browser_direct' && input.transport.access !== 'server_broker') {
            errors.push('http transport access must be browser_direct or server_broker');
        }
        if (typeof input.transport.path !== 'string' || !input.transport.path.startsWith('/') || input.transport.path.includes('..')) {
            errors.push('transport.path must be an absolute path without ..');
        }
        if (
            typeof input.transport.method === 'string'
            && METHODS.includes(input.transport.method as HttpMethod)
            && EFFECTS.includes(effect)
            && !effectAllowedForMethod(input.transport.method as HttpMethod, effect)
        ) {
            errors.push(`effect ${effect} is not allowed for ${input.transport.method}`);
        }
    } else if (input.transport.kind === 'mcp') {
        if (typeof input.transport.serverId !== 'string' || !/^[A-Za-z0-9_.:-]{1,80}$/.test(input.transport.serverId)) {
            errors.push('transport.serverId is invalid');
        }
        if (typeof input.transport.toolName !== 'string' || !NAME_PATTERN.test(input.transport.toolName)) {
            errors.push('transport.toolName is invalid');
        }
    } else if (typeof input.transport.handler !== 'string' || !/^[a-z][a-z0-9_.]{0,63}$/.test(input.transport.handler)) {
        errors.push('transport.handler is invalid');
    }

    validateExecution(input.execution, isRecord(input.transport) ? input.transport.kind : undefined, errors);

    if (!Array.isArray(input.inputs)) {
        errors.push('inputs must be a list');
    } else if (input.inputs.length > MAX_MANIFEST_INPUTS) {
        errors.push(`inputs exceeds ${MAX_MANIFEST_INPUTS}`);
    } else if (isRecord(input.transport)) {
        const names = new Set<string>();
        let bodies = 0;
        const transportKind = input.transport.kind;
        const method = input.transport.method;
        for (const entry of input.inputs) {
            if (!isRecord(entry)) {
                errors.push('each input must be an object');
                continue;
            }
            if (typeof entry.name !== 'string' || !NAME_PATTERN.test(entry.name)) {
                errors.push('input name is invalid');
            } else if (names.has(entry.name)) {
                errors.push(`duplicate input ${entry.name}`);
            } else {
                names.add(entry.name);
            }
            if (typeof entry.in !== 'string' || !LOCATIONS.includes(entry.in as InputLocation)) {
                errors.push(`input ${String(entry.name)} location is invalid`);
            }
            if (typeof entry.required !== 'boolean') errors.push(`input ${String(entry.name)} required must be boolean`);
            errors.push(...validateValueType(entry.schema, `inputs.${String(entry.name)}.schema`));
            if (entry.in === 'body') bodies += 1;
            if (transportKind === 'http' && entry.in === 'argument') {
                errors.push('http transports cannot take argument inputs');
            }
            if ((transportKind === 'mcp' || transportKind === 'local' || transportKind === 'async') && entry.in !== 'argument') {
                errors.push(`${String(transportKind)} transports only take argument inputs`);
            }
            if ((method === 'GET' || method === 'HEAD') && entry.in === 'body') {
                errors.push(`${String(method)} cannot declare a body`);
            }
        }
        if (bodies > 1) errors.push('at most one body input is supported');

        if (transportKind === 'http' && typeof input.transport.path === 'string') {
            const declared = input.inputs
                .filter(entry => isRecord(entry) && entry.in === 'path')
                .map(entry => (entry as CapabilityInput).name);
            const placeholders = pathParamNames(input.transport.path);
            for (const name of placeholders) {
                const inputDef = input.inputs.find(entry => isRecord(entry) && entry.name === name && entry.in === 'path') as CapabilityInput | undefined;
                if (!inputDef) errors.push(`path placeholder {${name}} has no path input`);
                else if (!inputDef.required) errors.push(`path input ${name} must be required`);
            }
            for (const name of declared) {
                if (!placeholders.includes(name)) errors.push(`path input ${name} is not in the path`);
            }
        }

        if (isRecord(input.auth) && input.auth.kind === 'apiKey' && typeof input.auth.name === 'string') {
            const authName = input.auth.name;
            const collision = input.inputs.find(entry =>
                isRecord(entry) && entry.name === authName && (entry.in === 'header' || entry.in === 'query')
            );
            if (collision) errors.push(`input collides with auth placement ${authName}`);
        }
    }

    if (!isRecord(input.output)) {
        errors.push('output is required');
    } else {
        errors.push(...validateValueType(input.output.schema, 'output.schema'));
        if (input.output.presentation !== 'items' && input.output.presentation !== 'content' && input.output.presentation !== 'raw') {
            errors.push('output.presentation is invalid');
        }
        for (const key of ['itemsPath', 'titlePath'] as const) {
            if (input.output[key] !== undefined && (typeof input.output[key] !== 'string' || (input.output[key] as string).includes('..'))) {
                errors.push(`output.${key} must be a dot path`);
            }
        }
    }

    if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.digest)) {
        errors.push('digest must be a sha256 hex string');
    }

    if (errors.length === 0 && isRecord(input.provenance)) {
        const expected = schemaDigestFor({
            inputs: (input.inputs as CapabilityInput[]).map(canonicalInput),
            output: canonicalOutput(input.output as CapabilityOutput)
        });
        if (input.provenance.schemaDigest !== expected) {
            errors.push('provenance.schemaDigest does not match inputs and output');
        }
    }

    if (errors.length === 0 && isRecord(input.transport)) {
        const transport = input.transport as CapabilityTransport;
        if (typeof input.id === 'string' && input.id !== canonicalCapabilityId(transport)) {
            errors.push(`id must be ${canonicalCapabilityId(transport)}`);
        }
        if (transport.kind === 'http' && isRecord(input.auth) && input.auth.kind !== 'none') {
            const auth = input.auth as unknown as AuthBinding;
            const slot = credentialSlot(transport.baseUrl, auth);
            if (auth.secretRef !== slot) errors.push(`auth.secretRef must be ${slot}`);
        }
        if ((transport.kind === 'mcp' || transport.kind === 'async') && isRecord(input.auth) && input.auth.kind !== 'none') {
            const auth = input.auth as unknown as AuthBinding;
            if (auth.kind === 'apiKey' && auth.in !== 'header') errors.push(`${transport.kind} credentials travel in a header`);
            const slot = transportCredentialSlot(transport, auth);
            if (auth.secretRef !== slot) errors.push(`auth.secretRef must be ${slot}`);
        }
    }

    if (errors.length > 0) return { ok: false, errors };

    const draft = canonicalDraft(input);
    const expected = sha256(canonicalize(digestPayload(draft)));
    if (expected !== input.digest) {
        return { ok: false, errors: ['digest does not match the manifest body'] };
    }
    return { ok: true, manifest: { ...draft, digest: expected }, errors: [] };
}

/** Rebuild from the fields execution is allowed to trust. */
function canonicalDraft(input: Record<string, unknown>): ManifestDraft {
    const source = input.source as CapabilitySource;
    const description = typeof input.description === 'string' ? input.description : undefined;
    return {
        version: CAPABILITY_MANIFEST_VERSION,
        id: input.id as string,
        title: input.title as string,
        ...(description ? { description } : {}),
        source: {
            kind: source.kind,
            locator: source.locator,
            ...(source.operationId ? { operationId: source.operationId } : {})
        },
        ...(isRecord(input.provenance) ? { provenance: canonicalProvenance(input.provenance as unknown as CapabilityProvenance) } : {}),
        effect: input.effect as CapabilityEffect,
        effectSource: input.effectSource as EffectSource,
        approval: input.approval as CapabilityApproval,
        invocation: triggerInvocation(normalizeTrigger(input.trigger as CapabilityTrigger | undefined, input.invocation === 'manual' ? 'manual' : 'auto')),
        trigger: normalizeTrigger(input.trigger as CapabilityTrigger | undefined, input.invocation === 'manual' ? 'manual' : 'auto'),
        auth: canonicalAuth(input.auth as AuthBinding),
        transport: canonicalTransport(input.transport as CapabilityTransport),
        ...(isRecord(input.execution) && input.execution.kind === 'async_poll'
            ? {
                execution: {
                    kind: 'async_poll' as const,
                    pollIntervalMs: input.execution.pollIntervalMs as number,
                    maxDurationMs: input.execution.maxDurationMs as number
                }
            }
            : {}),
        inputs: (input.inputs as CapabilityInput[]).map(canonicalInput),
        output: canonicalOutput(input.output as CapabilityOutput)
    };
}

export function canonicalInput(entry: CapabilityInput): CapabilityInput {
    return {
        name: entry.name,
        in: entry.in,
        required: entry.required,
        schema: entry.schema
    };
}

function canonicalProvenance(provenance: CapabilityProvenance): CapabilityProvenance {
    return {
        providerId: provenance.providerId,
        providerKind: provenance.providerKind,
        externalId: provenance.externalId,
        sourceLocator: provenance.sourceLocator,
        ...(provenance.sourceRevision ? { sourceRevision: provenance.sourceRevision } : {}),
        discoveredAtMs: provenance.discoveredAtMs,
        admittedAtMs: provenance.admittedAtMs,
        schemaDigest: provenance.schemaDigest
    };
}

function canonicalAuth(auth: AuthBinding): AuthBinding {
    if (auth.kind === 'none') return { kind: 'none' };
    return {
        kind: auth.kind,
        ...(auth.in ? { in: auth.in } : {}),
        ...(auth.name ? { name: auth.name } : {}),
        ...(auth.prefix ? { prefix: auth.prefix } : {}),
        ...(auth.scopes ? { scopes: canonicalScopes(auth.scopes) } : {}),
        ...(auth.secretRef ? { secretRef: auth.secretRef } : {})
    };
}

export function canonicalScopes(scopes: readonly string[]): string[] {
    return [...new Set(scopes)].sort();
}

function canonicalTransport(transport: CapabilityTransport): CapabilityTransport {
    if (transport.kind === 'mcp') {
        return { kind: 'mcp', serverId: transport.serverId, toolName: transport.toolName };
    }
    if (transport.kind === 'local') {
        return { kind: 'local', handler: transport.handler };
    }
    if (transport.kind === 'async') {
        return { kind: 'async', runtimeId: transport.runtimeId, operation: transport.operation };
    }
    return {
        kind: 'http',
        access: transport.access === 'server_broker' ? 'server_broker' : 'browser_direct',
        baseUrl: transport.baseUrl,
        method: transport.method,
        path: transport.path
    };
}

export function canonicalOutput(output: CapabilityOutput): CapabilityOutput {
    return {
        schema: output.schema,
        presentation: output.presentation,
        ...(output.itemsPath ? { itemsPath: output.itemsPath } : {}),
        ...(output.titlePath ? { titlePath: output.titlePath } : {})
    };
}
