// CapabilityManifest is the authoritative description of one callable.
// Compilers may propose one. validateManifest is what makes it real:
// a digest mismatch, an embedded secret, or an illegal effect/approval
// pair is rejected before anything is registered.

import { canonicalize, sha256 } from './hash';
import { canonicalCapabilityId, credentialSlot } from './identity';
import { validateValueType, type ValueType } from './valueType';

export const CAPABILITY_MANIFEST_VERSION = 1 as const;

export type CapabilityEffect = 'read' | 'compute' | 'write' | 'destructive';
export type CapabilityApproval = 'auto' | 'pending' | 'approved' | 'denied';
export type CapabilitySourceKind = 'openapi' | 'mcp' | 'bring';
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
    kind: 'none' | 'apiKey' | 'bearer' | 'basic';
    in?: 'header' | 'query';
    name?: string;
    prefix?: string;
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
    | { kind: 'local'; handler: string };

export interface CapabilityManifest {
    version: typeof CAPABILITY_MANIFEST_VERSION;
    id: string;
    title: string;
    description?: string;
    source: CapabilitySource;
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
const SOURCE_KINDS: CapabilitySourceKind[] = ['openapi', 'mcp', 'bring'];

const MANIFEST_KEYS = new Set([
    'version', 'id', 'title', 'description', 'source', 'effect', 'effectSource',
    'approval', 'invocation', 'trigger', 'auth', 'transport', 'inputs', 'output', 'digest'
]);

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

export function digestPayload(draft: ManifestDraft): unknown {
    return {
        version: draft.version,
        id: draft.id,
        title: draft.title,
        description: draft.description ?? null,
        source: draft.source,
        effect: draft.effect,
        effectSource: draft.effectSource,
        invocation: triggerInvocation(normalizeTrigger(draft.trigger, draft.invocation)),
        trigger: normalizeTrigger(draft.trigger, draft.invocation),
        auth: draft.auth,
        transport: draft.transport,
        inputs: draft.inputs,
        output: draft.output
    };
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
    const allowed = new Set(['kind', 'in', 'name', 'prefix', 'secretRef']);
    for (const key of Object.keys(auth)) {
        if (!allowed.has(key)) errors.push(`auth.${key} is not a manifest field`);
    }
    const kind = auth.kind;
    if (kind !== 'none' && kind !== 'apiKey' && kind !== 'bearer' && kind !== 'basic') {
        errors.push('auth.kind is invalid');
        return;
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
        if ((effect === 'write' || effect === 'destructive') && isRecord(input.transport) && input.transport.access === 'server_broker') {
            errors.push('server_broker cannot carry a write or destructive effect');
        }
    }

    if (!isRecord(input.transport) || (input.transport.kind !== 'http' && input.transport.kind !== 'mcp' && input.transport.kind !== 'local')) {
        errors.push('transport.kind must be http, mcp, or local');
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

    if (!Array.isArray(input.inputs)) {
        errors.push('inputs must be a list');
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
            if ((transportKind === 'mcp' || transportKind === 'local') && entry.in !== 'argument') {
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
        effect: input.effect as CapabilityEffect,
        effectSource: input.effectSource as EffectSource,
        approval: input.approval as CapabilityApproval,
        invocation: triggerInvocation(normalizeTrigger(input.trigger as CapabilityTrigger | undefined, input.invocation === 'manual' ? 'manual' : 'auto')),
        trigger: normalizeTrigger(input.trigger as CapabilityTrigger | undefined, input.invocation === 'manual' ? 'manual' : 'auto'),
        auth: canonicalAuth(input.auth as AuthBinding),
        transport: canonicalTransport(input.transport as CapabilityTransport),
        inputs: (input.inputs as CapabilityInput[]).map(entry => ({
            name: entry.name,
            in: entry.in,
            required: entry.required,
            schema: entry.schema
        })),
        output: canonicalOutput(input.output as CapabilityOutput)
    };
}

function canonicalAuth(auth: AuthBinding): AuthBinding {
    if (auth.kind === 'none') return { kind: 'none' };
    return {
        kind: auth.kind,
        ...(auth.in ? { in: auth.in } : {}),
        ...(auth.name ? { name: auth.name } : {}),
        ...(auth.prefix ? { prefix: auth.prefix } : {}),
        ...(auth.secretRef ? { secretRef: auth.secretRef } : {})
    };
}

function canonicalTransport(transport: CapabilityTransport): CapabilityTransport {
    if (transport.kind === 'mcp') {
        return { kind: 'mcp', serverId: transport.serverId, toolName: transport.toolName };
    }
    if (transport.kind === 'local') {
        return { kind: 'local', handler: transport.handler };
    }
    return {
        kind: 'http',
        access: transport.access === 'server_broker' ? 'server_broker' : 'browser_direct',
        baseUrl: transport.baseUrl,
        method: transport.method,
        path: transport.path
    };
}

function canonicalOutput(output: CapabilityOutput): CapabilityOutput {
    return {
        schema: output.schema,
        presentation: output.presentation,
        ...(output.itemsPath ? { itemsPath: output.itemsPath } : {}),
        ...(output.titlePath ? { titlePath: output.titlePath } : {})
    };
}
