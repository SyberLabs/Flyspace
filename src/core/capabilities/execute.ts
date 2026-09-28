// Installed manifests only. Proposals are not executable.
// Side effects stop here until approveCapability has moved them to `approved`.

import { readCapability } from './state';
import { capabilitySecrets } from './secrets';
import {
    brandResult,
    projectError,
    projectSuccess,
    type CapabilityResult,
    type TypedValue
} from './project';
import type { CapabilityManifest } from './manifest';
import { isRecord, validateValue } from './valueType';

const MAX_BODY_CHARS = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface McpTransport {
    call(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown>;
}

const mcpTransports = new Map<string, McpTransport>();
const lastResult = new Map<string, CapabilityResult>();

export function bindMcpTransport(serverId: string, transport: McpTransport): void {
    mcpTransports.set(serverId, transport);
}

export function unbindMcpTransport(serverId: string): void {
    mcpTransports.delete(serverId);
}

export function getLastResult(capabilityId: string): CapabilityResult | undefined {
    return lastResult.get(capabilityId);
}

export function clearLastResult(capabilityId?: string): void {
    if (capabilityId) lastResult.delete(capabilityId);
    else lastResult.clear();
}

export interface ExecuteOptions {
    fetchImpl?: typeof fetch;
}

export async function executeCapability(
    capabilityId: string,
    input: Record<string, unknown> = {},
    options: ExecuteOptions = {}
): Promise<CapabilityResult> {
    const manifest = readCapability(capabilityId);
    if (!manifest) return finish(failure(capabilityId, 'NOT_INSTALLED', 'Capability is not installed', false));

    if (manifest.approval === 'denied' || manifest.approval === 'pending') {
        return finish(failure(
            capabilityId,
            'EFFECT_NOT_APPROVED',
            `${manifest.effect} capability is ${manifest.approval}; execution is refused`,
            false
        ));
    }

    const inputErrors = validateInput(manifest, input);
    if (inputErrors.length > 0) {
        return finish(failure(capabilityId, 'INPUT_INVALID', inputErrors.join('; '), false));
    }

    const auth = applyAuth(manifest);
    if ('error' in auth) return finish(auth.error);

    try {
        const step = manifest.transport.kind === 'http'
            ? await executeHttp(manifest, input, auth.headers, auth.query, options.fetchImpl ?? fetch)
            : await executeMcp(manifest, input);
        if (step.type === 'halt') return finish(step.result);
        const value = step.value;

        const schemaErrors = validateValue(manifest.output.schema, value);
        if (schemaErrors.length > 0) {
            return finish(failure(
                capabilityId,
                'TYPED_OUTPUT_MISMATCH',
                schemaErrors.slice(0, 6).join('; '),
                false
            ));
        }
        const typed: TypedValue = { schema: manifest.output.schema, value };
        return finish({
            ok: true,
            capabilityId,
            typed,
            presentation: projectSuccess(manifest, typed)
        });
    } catch (error) {
        return finish(failure(
            capabilityId,
            'UPSTREAM_ERROR',
            error instanceof Error ? error.message : 'Unknown execution error',
            true
        ));
    }
}

function validateInput(manifest: CapabilityManifest, input: Record<string, unknown>): string[] {
    if (!isRecord(input)) return ['input must be an object'];
    const errors: string[] = [];
    const known = new Set(manifest.inputs.map(entry => entry.name));
    for (const key of Object.keys(input)) {
        if (!known.has(key)) errors.push(`unexpected input ${key}`);
    }
    for (const entry of manifest.inputs) {
        const present = input[entry.name] !== undefined;
        if (!present) {
            if (entry.required) errors.push(`${entry.name} is required`);
            continue;
        }
        errors.push(...validateValue(entry.schema, input[entry.name], entry.name));
    }
    return errors;
}

function applyAuth(manifest: CapabilityManifest): { headers: Record<string, string>; query: Record<string, string> } | { error: CapabilityResult } {
    const headers: Record<string, string> = {};
    const query: Record<string, string> = {};
    const auth = manifest.auth;
    if (auth.kind === 'none') return { headers, query };
    const secret = auth.secretRef ? capabilitySecrets.get(auth.secretRef) : undefined;
    if (!secret) {
        return {
            error: failure(manifest.id, 'AUTH_UNBOUND', `Secret slot ${auth.secretRef ?? '(missing)'} is empty`, false)
        };
    }
    if (auth.kind === 'bearer') {
        headers.Authorization = `Bearer ${secret}`;
    } else if (auth.kind === 'basic') {
        headers.Authorization = `Basic ${encodeBase64(secret)}`;
    } else if (auth.kind === 'apiKey' && auth.name) {
        const value = `${auth.prefix ?? ''}${secret}`;
        if (auth.in === 'query') query[auth.name] = value;
        else headers[auth.name] = value;
    }
    return { headers, query };
}

type Step = { type: 'value'; value: unknown } | { type: 'halt'; result: CapabilityResult };

function halt(result: CapabilityResult): Step {
    return { type: 'halt', result };
}

async function executeHttp(
    manifest: CapabilityManifest,
    input: Record<string, unknown>,
    authHeaders: Record<string, string>,
    authQuery: Record<string, string>,
    fetchImpl: typeof fetch
): Promise<Step> {
    if (manifest.transport.kind !== 'http') {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not an http capability', false));
    }
    const path = fillPath(manifest.transport.path, input);
    const url = joinUrl(manifest.transport.baseUrl, path);
    const headers: Record<string, string> = { accept: 'application/json', ...authHeaders };
    for (const entry of manifest.inputs) {
        if (input[entry.name] === undefined) continue;
        if (entry.in === 'query') url.searchParams.set(entry.name, stringifyParam(input[entry.name]));
        if (entry.in === 'header') headers[entry.name] = stringifyParam(input[entry.name]);
    }
    for (const [key, value] of Object.entries(authQuery)) url.searchParams.set(key, value);

    let body: string | undefined;
    const bodyInput = manifest.inputs.find(entry => entry.in === 'body');
    if (bodyInput && input[bodyInput.name] !== undefined) {
        body = JSON.stringify(input[bodyInput.name]);
        if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
    }

    const response = await fetchImpl(url.toString(), {
        method: manifest.transport.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        return halt(failure(manifest.id, 'HTTP_REDIRECT_REFUSED', 'Redirects are not followed', false));
    }
    if (response.status < 200 || response.status >= 300) {
        return halt(failure(manifest.id, 'HTTP_ERROR', `HTTP ${response.status}`, response.status >= 500));
    }

    const text = await response.text();
    if (text.length > MAX_BODY_CHARS) {
        return halt(failure(manifest.id, 'PAYLOAD_TOO_LARGE', 'Response exceeded 1MB', false));
    }
    if (text.trim() === '') return { type: 'value', value: null };

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
        try {
            return { type: 'value', value: JSON.parse(text) as unknown };
        } catch {
            return halt(failure(manifest.id, 'UPSTREAM_PARSE', 'Response was not valid JSON', false));
        }
    }
    if (manifest.output.schema.kind === 'string' || manifest.output.schema.kind === 'any') {
        return { type: 'value', value: text };
    }
    return halt(failure(manifest.id, 'UPSTREAM_PARSE', 'Response was not JSON', false));
}

async function executeMcp(manifest: CapabilityManifest, input: Record<string, unknown>): Promise<Step> {
    if (manifest.transport.kind !== 'mcp') {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not an mcp capability', false));
    }
    const transport = mcpTransports.get(manifest.transport.serverId);
    if (!transport) {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', `No MCP transport bound for ${manifest.transport.serverId}`, false));
    }
    const args: Record<string, unknown> = {};
    for (const entry of manifest.inputs) {
        if (input[entry.name] !== undefined) args[entry.name] = input[entry.name];
    }
    return { type: 'value', value: await transport.call(manifest.transport.serverId, manifest.transport.toolName, args) };
}

function fillPath(path: string, input: Record<string, unknown>): string {
    return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
        const value = input[name];
        return encodeURIComponent(stringifyParam(value));
    });
}

function stringifyParam(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

export function joinUrl(baseUrl: string, path: string): URL {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const relative = path.startsWith('/') ? path.slice(1) : path;
    return new URL(relative, base);
}

function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function failure(capabilityId: string, code: string, message: string, retryable: boolean): CapabilityResult {
    const error = { code, message, retryable };
    return {
        ok: false,
        capabilityId,
        typed: null,
        presentation: projectError(capabilityId, error),
        error
    };
}

function finish(result: CapabilityResult): CapabilityResult {
    brandResult(result);
    lastResult.set(result.capabilityId, result);
    return result;
}
