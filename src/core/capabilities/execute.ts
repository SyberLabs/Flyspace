// Installed manifests only. Proposals are not executable.
// Side effects stop here until approveCapability has moved them to `approved`.

import { sha256 } from './hash';
import {
    admitExecution,
    finishExecution,
    getExecutionRecord,
    latestExecutionRecord,
    markExecutionDispatched,
    type ExecutionRecord
} from './executionLedger';
import { readCapability } from './state';
import { capabilitySecrets } from './secrets';
import {
    brandResult,
    projectError,
    projectSuccess,
    type CapabilityResult,
    type TypedValue
} from './project';
import type { CapabilityEffect, CapabilityManifest } from './manifest';
import { isRecord, validateValue } from './valueType';

const MAX_BODY_CHARS = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface McpTransport {
    call(serverId: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

export interface LocalCall {
    signal?: AbortSignal;
}

export type ExecutionStatus = 'admitted' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'uncertain';

export interface CapabilityExecution {
    runId: string;
    capabilityId: string;
    manifestDigest: string;
    effect: CapabilityEffect;
    inputDigest: string;
    idempotencyKey: string;
    startedAt: number;
    deadlineAt: number;
    dispatchedAt?: number;
    status: ExecutionStatus;
}

const mcpTransports = new Map<string, McpTransport>();
const localHandlers = new Map<string, (args: Record<string, unknown>, call?: LocalCall) => Promise<unknown>>();
const lastResult = new Map<string, CapabilityResult>();

export function bindLocalHandler(
    handler: string,
    fn: (args: Record<string, unknown>, call?: LocalCall) => Promise<unknown>
): void {
    localHandlers.set(handler, fn);
}

export function unbindLocalHandler(handler: string): void {
    localHandlers.delete(handler);
}

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

export function getExecution(runId: string): CapabilityExecution | undefined {
    const record = getExecutionRecord(runId);
    return record ? toExecution(record) : undefined;
}

export function latestExecution(capabilityId: string): CapabilityExecution | undefined {
    const record = latestExecutionRecord(capabilityId);
    return record ? toExecution(record) : undefined;
}

export interface ExecuteOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** Same key and same input replays. Same key and different input conflicts. */
    idempotencyKey?: string;
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
    if ('error' in auth) return finish(auth.error, undefined);

    if (options.idempotencyKey !== undefined && !/^[A-Za-z0-9._~-]{8,128}$/.test(options.idempotencyKey)) {
        return finish(failure(capabilityId, 'INPUT_INVALID', 'idempotency key is invalid', false));
    }
    const idempotencyKey = options.idempotencyKey
        ?? `once_${sha256(`${manifest.digest}|${Date.now()}|${Math.random()}`).slice(0, 32)}`;
    const admission = admitExecution({
        capabilityId,
        manifestDigest: manifest.digest,
        effect: manifest.effect,
        input,
        idempotencyKey,
        deadlineMs: REQUEST_TIMEOUT_MS + 5_000
    });
    if (admission.kind !== 'admit') return replay(manifest, admission.record, admission.kind);

    const run = toExecution(admission.record);
    const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
    let dispatched = false;

    try {
        if (options.signal?.aborted) {
            return finish(failure(capabilityId, 'CANCELED', 'Execution was canceled', false), run, 'canceled');
        }
        const step = await dispatch(
            manifest,
            input,
            auth.headers,
            auth.query,
            options.fetchImpl ?? fetch,
            options.signal,
            idempotencyKey,
            auth.secret,
            () => {
                dispatched = true;
                markExecutionDispatched(run.runId);
                run.dispatchedAt = Date.now();
                run.status = 'running';
            }
        );
        if (step.type === 'halt') {
            const uncertain = step.result.error?.code === 'EFFECT_UNCERTAIN';
            return finish(step.result, run, uncertain ? 'uncertain' : 'failed');
        }
        const value = step.value;

        const schemaErrors = validateValue(manifest.output.schema, value);
        if (schemaErrors.length > 0) {
            return finish(failure(
                capabilityId,
                'TYPED_OUTPUT_MISMATCH',
                schemaErrors.slice(0, 6).join('; '),
                false
            ), run, 'failed');
        }
        const typed: TypedValue = { schema: manifest.output.schema, value };
        return finish({
            ok: true,
            capabilityId,
            typed,
            presentation: projectSuccess(manifest, typed)
        }, run, 'succeeded');
    } catch (error) {
        if (dispatched && sideEffect) {
            return finish(failure(
                capabilityId,
                'EFFECT_UNCERTAIN',
                'The call was dispatched and the outcome was not observed. Do not retry automatically.',
                false
            ), run, 'uncertain');
        }
        const aborted = options.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
        if (aborted) {
            return finish(failure(capabilityId, 'CANCELED', 'Execution was canceled', false), run, 'canceled');
        }
        return finish(failure(
            capabilityId,
            'UPSTREAM_ERROR',
            error instanceof Error ? error.message : 'Unknown execution error',
            manifest.effect === 'read' || manifest.effect === 'compute'
        ), run, 'failed');
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

function applyAuth(manifest: CapabilityManifest): { headers: Record<string, string>; query: Record<string, string>; secret?: string } | { error: CapabilityResult } {
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
    return { headers, query, secret };
}

type Step = { type: 'value'; value: unknown } | { type: 'halt'; result: CapabilityResult };

async function dispatch(
    manifest: CapabilityManifest,
    input: Record<string, unknown>,
    authHeaders: Record<string, string>,
    authQuery: Record<string, string>,
    fetchImpl: typeof fetch,
    signal: AbortSignal | undefined,
    idempotencyKey: string,
    secret: string | undefined,
    markDispatched: () => void
): Promise<Step> {
    if (manifest.transport.kind === 'http') {
        return executeHttp(manifest, input, authHeaders, authQuery, fetchImpl, signal, idempotencyKey, secret, markDispatched);
    }
    markDispatched();
    if (manifest.transport.kind === 'mcp') return executeMcp(manifest, input, signal);
    return executeLocal(manifest, input, signal);
}

function halt(result: CapabilityResult): Step {
    return { type: 'halt', result };
}

async function executeHttp(
    manifest: CapabilityManifest,
    input: Record<string, unknown>,
    authHeaders: Record<string, string>,
    authQuery: Record<string, string>,
    fetchImpl: typeof fetch,
    signal: AbortSignal | undefined,
    idempotencyKey: string,
    secret: string | undefined,
    markDispatched: () => void
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

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    markDispatched();
    if (manifest.transport.access === 'server_broker') {
        return executeBroker(manifest, input, idempotencyKey, secret, fetchImpl, requestSignal);
    }
    const response = await fetchImpl(url.toString(), {
        method: manifest.transport.method,
        headers,
        body,
        redirect: 'manual',
        signal: requestSignal
    });

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        return halt(failure(manifest.id, 'HTTP_REDIRECT_REFUSED', 'Redirects are not followed', false));
    }
    if (response.status < 200 || response.status >= 300) {
        const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
        const retryable = !sideEffect && response.status >= 500;
        return halt(failure(manifest.id, 'HTTP_ERROR', `HTTP ${response.status}`, retryable));
    }

    const bodyText = await readBounded(response, manifest.id);
    if (bodyText.type !== 'text') return bodyText;
    const text = bodyText.text;
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

async function readBounded(response: Response, capabilityId: string): Promise<{ type: 'text'; text: string } | Step> {
    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_BODY_CHARS) {
        await response.body?.cancel().catch(() => undefined);
        return halt(failure(capabilityId, 'PAYLOAD_TOO_LARGE', 'Response exceeded 1MB', false));
    }
    if (!response.body) {
        const text = await response.text();
        if (text.length > MAX_BODY_CHARS) {
            return halt(failure(capabilityId, 'PAYLOAD_TOO_LARGE', 'Response exceeded 1MB', false));
        }
        return { type: 'text', text };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > MAX_BODY_CHARS) {
            await reader.cancel().catch(() => undefined);
            return halt(failure(capabilityId, 'PAYLOAD_TOO_LARGE', 'Response exceeded 1MB', false));
        }
    }
    text += decoder.decode();
    return { type: 'text', text };
}

async function executeLocal(manifest: CapabilityManifest, input: Record<string, unknown>, signal?: AbortSignal): Promise<Step> {
    if (manifest.transport.kind !== 'local') {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not a local capability', false));
    }
    const handler = localHandlers.get(manifest.transport.handler);
    if (!handler) {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', `No local handler bound for ${manifest.transport.handler}`, false));
    }
    const args: Record<string, unknown> = {};
    for (const entry of manifest.inputs) {
        if (input[entry.name] !== undefined) args[entry.name] = input[entry.name];
    }
    return { type: 'value', value: await handler(args, { signal }) };
}

async function executeBroker(
    manifest: CapabilityManifest,
    input: Record<string, unknown>,
    idempotencyKey: string,
    secret: string | undefined,
    fetchImpl: typeof fetch,
    signal: AbortSignal
): Promise<Step> {
    const response = await fetchImpl('/api/capability-broker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            manifest,
            input,
            idempotencyKey,
            ...(secret ? { secret } : {})
        }),
        signal
    });
    const payload = await response.json() as {
        value?: unknown;
        error?: { code?: string; message?: string };
        executionStatus?: string;
    };
    if (payload.error) {
        return halt(failure(
            manifest.id,
            payload.error.code || 'UPSTREAM_ERROR',
            payload.error.message || 'Broker request failed',
            false
        ));
    }
    if (!response.ok) {
        return halt(failure(manifest.id, 'UPSTREAM_ERROR', `Broker HTTP ${response.status}`, false));
    }
    return { type: 'value', value: payload.value };
}

async function executeMcp(manifest: CapabilityManifest, input: Record<string, unknown>, signal?: AbortSignal): Promise<Step> {
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
    return { type: 'value', value: await transport.call(manifest.transport.serverId, manifest.transport.toolName, args, signal) };
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

function toExecution(record: ExecutionRecord): CapabilityExecution {
    return {
        runId: record.runId,
        capabilityId: record.capabilityId,
        manifestDigest: record.manifestDigest,
        effect: record.effect,
        inputDigest: record.inputDigest,
        idempotencyKey: record.idempotencyKey,
        startedAt: record.startedAt,
        deadlineAt: record.deadlineAt,
        ...(record.dispatchedAt ? { dispatchedAt: record.dispatchedAt } : {}),
        status: record.status
    };
}

function replay(manifest: CapabilityManifest, record: ExecutionRecord, kind: 'replay' | 'conflict' | 'in_flight' | 'uncertain'): CapabilityResult {
    if (kind === 'conflict') {
        return remembered(failure(manifest.id, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different input', false), record.runId);
    }
    if (kind === 'in_flight') {
        return remembered(failure(manifest.id, 'IN_FLIGHT', 'This idempotency key already has a run in progress', false), record.runId);
    }
    if (kind === 'uncertain' || record.status === 'uncertain') {
        return remembered(failure(
            manifest.id,
            'EFFECT_UNCERTAIN',
            record.receipt?.message ?? 'The call was dispatched and the outcome was not observed. Do not retry automatically.',
            false
        ), record.runId);
    }
    if (record.receipt?.ok) {
        const typed: TypedValue = { schema: manifest.output.schema, value: record.receipt.value };
        return remembered({
            ok: true,
            capabilityId: manifest.id,
            typed,
            presentation: projectSuccess(manifest, typed)
        }, record.runId);
    }
    return remembered(failure(
        manifest.id,
        record.receipt?.code ?? 'UPSTREAM_ERROR',
        record.receipt?.message ?? 'The previous run failed',
        false
    ), record.runId);
}

function remembered(result: CapabilityResult, runId: string): CapabilityResult {
    result.runId = runId;
    brandResult(result);
    lastResult.set(result.capabilityId, result);
    return result;
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

function finish(
    result: CapabilityResult,
    run?: CapabilityExecution,
    status?: ExecutionStatus
): CapabilityResult {
    if (run && status && status !== 'admitted' && status !== 'running') {
        run.status = status;
        const receipt = result.ok
            ? { ok: true, value: result.typed?.value }
            : { ok: false, code: result.error?.code, message: result.error?.message };
        finishExecution(run.runId, status, receipt);
        result.runId = run.runId;
    } else if (run) {
        result.runId = run.runId;
    }
    brandResult(result);
    lastResult.set(result.capabilityId, result);
    return result;
}
