// Installed manifests only. Proposals are not executable.
// Side effects stop here until approveCapability has moved them to `approved`.

import { canonicalize, sha256 } from './hash';
import { joinUrl, resolveHttpPath, stringifyParam } from './httpTarget';
import { redact } from './redact';
import {
    admitExecution,
    executionRecord,
    executionRecords,
    finishExecution,
    markExecutionDispatched,
    observeExecution,
    recordExternalRun,
    recordUncertainObservation,
    settleUncertainExecution,
    type ExecutionPhase,
    type ExecutionReceipt,
    type ExecutionRecord
} from './executionLedger';
import {
    AsyncStartRejected,
    EXTERNAL_RUN_ID_PATTERN,
    asyncRuntime,
    pollUntilSettled,
    systemClock,
    type AsyncClock,
    type PollOutcome
} from './asyncRuntime';
import { readCapability } from './state';
import { capabilitySecrets } from './secrets';
import {
    projectError,
    projectSuccess,
    type CapabilityResult,
    type TypedValue
} from './project';
import type { CapabilityExecutionProfile, CapabilityManifest } from './manifest';
import { isRecord, validateValue } from './valueType';
import { toJsonValue } from './jsonValue';

const MAX_BODY_CHARS = 1_000_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Per-call credential placement resolved from the manifest's slot. */
export interface McpCallContext {
    headers: Record<string, string>;
}

export interface McpTransport {
    call(
        serverId: string,
        toolName: string,
        args: Record<string, unknown>,
        signal?: AbortSignal,
        context?: McpCallContext
    ): Promise<unknown>;
}

export interface LocalCall {
    signal?: AbortSignal;
}

const mcpTransports = new Map<string, McpTransport>();
const localHandlers = new Map<string, (args: Record<string, unknown>, call?: LocalCall) => Promise<unknown>>();

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

export interface ExecuteOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    /** Same key and same input replays. Same key and different input conflicts. */
    idempotencyKey?: string;
    /** Time source for async_poll waits. Tests inject one instead of sleeping. */
    clock?: AsyncClock;
    /**
     * Write and destructive runs only: the digest of the RunPreview a person
     * confirmed. A run whose request differs from that preview is refused.
     */
    confirmedRun?: string;
}

export { joinUrl };

/** What a write or destructive run will send, shown to a person before it is sent. */
export interface RunPreview {
    capabilityId: string;
    effect: CapabilityManifest['effect'];
    /** HTTP method, or CALL / START for a tool or job transport. */
    method: string;
    /** The resolved request URL without any credential, or the tool or job it targets. */
    url: string;
    arguments: Record<string, unknown>;
    /** Where the credential travels, never its value. */
    credential?: string;
    digest: string;
}

/**
 * Validate a run and describe it without dispatching anything. The digest
 * binds the manifest, method, URL, arguments and, for http, the exact
 * header values and body text; executeCapability accepts a write or
 * destructive run only with the digest of its own preview.
 */
export function previewCapabilityRun(
    capabilityId: string,
    input: Record<string, unknown> = {}
): { ok: true; preview: RunPreview } | { ok: false; result: CapabilityResult } {
    const manifest = readCapability(capabilityId);
    if (!manifest) return { ok: false, result: failure(capabilityId, 'NOT_INSTALLED', 'Capability is not installed', false) };
    if (manifest.approval === 'denied' || manifest.approval === 'pending') {
        return { ok: false, result: failure(capabilityId, 'EFFECT_NOT_APPROVED', `${manifest.effect} capability is ${manifest.approval}; execution is refused`, false) };
    }
    const checked = checkInput(manifest, input);
    if ('errors' in checked) return { ok: false, result: failure(capabilityId, 'INPUT_INVALID', checked.errors.join('; '), false) };
    const prepared = prepareRun(manifest, checked.args);
    if ('error' in prepared) return { ok: false, result: failure(capabilityId, 'INPUT_INVALID', prepared.error, false) };
    return { ok: true, preview: prepared.run.preview };
}

/** The exact http request one run sends, before the credential is attached. */
interface HttpPlan {
    /** Path and query inputs applied. */
    url: string;
    /** Header inputs, as sent. */
    headers: Record<string, string>;
    /** The body text, as sent. */
    body?: string;
}

/**
 * One run, prepared once. Its preview digest is computed from these objects,
 * and dispatch sends these same objects, so what a person confirmed and
 * what leaves the process cannot differ.
 */
interface PreparedRun {
    /** Frozen, JSON-only, and the exact object each transport receives. */
    args: Readonly<Record<string, unknown>>;
    http?: HttpPlan;
    preview: RunPreview;
}

function prepareRun(manifest: CapabilityManifest, args: Readonly<Record<string, unknown>>): { run: PreparedRun } | { error: string } {
    const transport = manifest.transport;
    let method: string;
    let url: string;
    let http: HttpPlan | undefined;
    if (transport.kind === 'http') {
        const target = resolveHttpPath(transport.baseUrl, transport.path, args);
        if ('error' in target) return { error: target.error };
        const headers = Object.create(null) as Record<string, string>;
        let body: string | undefined;
        const credentialHeader = credentialHeaderName(manifest);
        for (const entry of manifest.inputs) {
            if (!Object.hasOwn(args, entry.name)) continue;
            // Header names are case-insensitive: an input in the credential's
            // header would replace or join it.
            if (entry.in === 'header' && entry.name.toLowerCase() === credentialHeader) {
                return { error: `${entry.name} carries the credential and cannot be supplied as an input` };
            }
            const value = args[entry.name];
            if (entry.in === 'query') target.url.searchParams.set(entry.name, stringifyParam(value));
            else if (entry.in === 'header') headers[entry.name] = stringifyParam(value);
            else if (entry.in === 'body') body = JSON.stringify(value);
        }
        method = transport.method;
        url = target.url.toString();
        http = { url, headers, ...(body !== undefined ? { body } : {}) };
    } else if (transport.kind === 'mcp') {
        method = 'CALL';
        url = `mcp:${transport.serverId}/${transport.toolName}`;
    } else if (transport.kind === 'async') {
        method = 'START';
        url = `async:${transport.runtimeId}/${transport.operation}`;
    } else {
        method = 'CALL';
        url = `local:${transport.handler}`;
    }
    const credential = credentialPlacement(manifest);
    // The arguments are hashed as the exact text a JSON encoder writes for
    // this frozen object, and this object is what the transport receives.
    const digest = sha256(canonicalize({
        capabilityId: manifest.id,
        manifestDigest: manifest.digest,
        method,
        url,
        argumentsJson: JSON.stringify(args),
        ...(http ? { headers: http.headers, body: http.body } : {})
    }));
    return {
        run: {
            args,
            ...(http ? { http } : {}),
            preview: {
                capabilityId: manifest.id,
                effect: manifest.effect,
                method,
                url,
                arguments: args,
                ...(credential ? { credential } : {}),
                digest
            }
        }
    };
}

/** The header the credential travels in, lower-cased, or undefined. */
function credentialHeaderName(manifest: CapabilityManifest): string | undefined {
    const auth = manifest.auth;
    if (auth.kind === 'none') return undefined;
    if (auth.kind === 'apiKey') return auth.in === 'query' ? undefined : auth.name?.toLowerCase();
    return 'authorization';
}

function credentialPlacement(manifest: CapabilityManifest): string | undefined {
    const auth = manifest.auth;
    if (auth.kind === 'none') return undefined;
    if (auth.kind === 'apiKey') return auth.in === 'query' ? `query parameter ${auth.name}` : `header ${auth.name}`;
    return 'Authorization header';
}

type AsyncProfile = Extract<CapabilityExecutionProfile, { kind: 'async_poll' }>;

const UNOBSERVED = 'The external run started and its outcome was not observed. Do not retry automatically.';

/** Runs this session is polling right now. Recovery leaves them alone. */
const activeAsyncRuns = new Set<string>();

async function executeAsync(
    manifest: CapabilityManifest,
    profile: AsyncProfile,
    args: Readonly<Record<string, unknown>>,
    headers: Record<string, string>,
    record: ExecutionRecord,
    idempotencyKey: string,
    signal: AbortSignal | undefined,
    clock: AsyncClock,
    secret: string | undefined
): Promise<CapabilityResult> {
    const runId = record.runId;
    const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
    if (manifest.transport.kind !== 'async') {
        return finish(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not an async capability', false), runId, 'failed', clock.now());
    }
    const { runtimeId, operation } = manifest.transport;
    const runtime = asyncRuntime(runtimeId);
    if (!runtime) {
        return finish(failure(manifest.id, 'TRANSPORT_NOT_BOUND', `No async runtime bound for ${runtimeId}`, false), runId, 'failed', clock.now());
    }
    if (signal?.aborted) {
        return finish(failure(manifest.id, 'CANCELED', 'Execution was canceled', false), runId, 'canceled', clock.now());
    }

    activeAsyncRuns.add(runId);
    try {
        markExecutionDispatched(runId, clock.now());
        let externalRunId: unknown;
        try {
            const started = await runtime.start(operation, args, {
                headers: { ...headers },
                signal: bounded(signal),
                idempotencyKey
            });
            externalRunId = started?.externalRunId;
        } catch (error) {
            if (error instanceof AsyncStartRejected) {
                return finish(dispatchedFailure(manifest, 'ASYNC_START_REJECTED', error.message, false, secret), runId, 'failed', clock.now());
            }
            if (sideEffect || signal?.aborted) {
                return finish(failure(manifest.id, 'EFFECT_UNCERTAIN', UNOBSERVED, false), runId, 'uncertain', clock.now());
            }
            return finish(dispatchedFailure(
                manifest,
                'UPSTREAM_ERROR',
                error instanceof Error ? error.message : 'The start request failed',
                false,
                secret
            ), runId, 'failed', clock.now());
        }
        if (typeof externalRunId !== 'string' || !EXTERNAL_RUN_ID_PATTERN.test(externalRunId)) {
            return sideEffect
                ? finish(failure(manifest.id, 'EFFECT_UNCERTAIN', `The start returned no usable run id. ${UNOBSERVED}`, false), runId, 'uncertain', clock.now())
                : finish(failure(manifest.id, 'UPSTREAM_PARSE', 'The start returned no usable run id', false), runId, 'failed', clock.now());
        }
        recordExternalRun(runId, externalRunId, clock.now());
        const outcome = await pollUntilSettled({
            runtime,
            operation,
            externalRunId,
            headers,
            idempotencyKey,
            pollIntervalMs: profile.pollIntervalMs,
            deadlineAt: record.startedAt + profile.maxDurationMs,
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            clock,
            signal,
            onObserve: (status, at) => observeExecution(runId, status, at)
        });
        return settleAsync(manifest, runId, outcome, 'running', clock.now(), secret);
    } finally {
        activeAsyncRuns.delete(runId);
    }
}

function settleAsync(
    manifest: CapabilityManifest,
    runId: string,
    outcome: PollOutcome,
    from: 'running' | 'uncertain',
    at: number,
    secret: string | undefined
): CapabilityResult {
    const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
    let result: CapabilityResult;
    let status: 'succeeded' | 'failed' | 'uncertain';
    if (outcome.kind === 'succeeded') {
        const schemaErrors = validateValue(manifest.output.schema, outcome.value);
        if (schemaErrors.length > 0) {
            const detail = schemaErrors.slice(0, 6).join('; ');
            if (sideEffect) {
                // The external run id is already recorded, and the destination
                // said the run succeeded. Rejecting the value must not read as
                // a clean failure that invites another start under the same key.
                result = dispatchedFailure(
                    manifest,
                    'TYPED_OUTPUT_MISMATCH',
                    `The destination reported success and the value was rejected: ${detail}`,
                    false,
                    secret
                );
                status = 'uncertain';
            } else {
                result = dispatchedFailure(manifest, 'TYPED_OUTPUT_MISMATCH', detail, false, secret);
                status = 'failed';
            }
        } else {
            const typed: TypedValue = { schema: manifest.output.schema, value: outcome.value };
            result = { ok: true, capabilityId: manifest.id, typed, presentation: projectSuccess(manifest, typed) };
            status = 'succeeded';
        }
    } else if (outcome.kind === 'failed') {
        result = dispatchedFailure(manifest, 'ASYNC_RUN_FAILED', outcome.message, false, secret);
        status = 'failed';
    } else if (outcome.kind === 'canceled') {
        result = failure(manifest.id, 'EFFECT_UNCERTAIN', `Polling was canceled. ${UNOBSERVED}`, false);
        status = 'uncertain';
    } else if (sideEffect) {
        result = failure(manifest.id, 'EFFECT_UNCERTAIN', UNOBSERVED, false);
        status = 'uncertain';
    } else {
        const code = outcome.kind === 'deadline' ? 'DEADLINE' : 'UNOBSERVABLE';
        result = dispatchedFailure(manifest, code, outcome.kind === 'deadline' ? 'The run did not finish within its profile' : outcome.message, false, secret);
        status = 'failed';
    }

    if (from === 'running') return finish(result, runId, status, at);
    if (outcome.kind === 'succeeded' || outcome.kind === 'failed') {
        if (status === 'uncertain') recordUncertainObservation(runId, receiptFor(result));
        else settleUncertainExecution(runId, status, receiptFor(result), at);
    }
    result.runId = runId;
    return result;
}

export interface ReconcileReport {
    runId: string;
    status: ExecutionPhase;
    observed: boolean;
    reason?: string;
    result?: CapabilityResult;
}

/**
 * Query the destination for one async run by its external run id. This
 * observes; it never starts the job again. An uncertain run closes only if
 * the destination reports a terminal status.
 */
export async function reconcileAsyncExecution(
    runId: string,
    options: { clock?: AsyncClock; signal?: AbortSignal } = {}
): Promise<ReconcileReport> {
    const clock = options.clock ?? systemClock;
    const record = executionRecord(runId);
    if (!record || record.executionProfile !== 'async_poll') {
        return { runId, status: record?.status ?? 'failed', observed: false, reason: 'not an async run' };
    }
    if (activeAsyncRuns.has(runId)) return { runId, status: record.status, observed: false, reason: 'polling in this session' };
    const sideEffect = record.effect === 'write' || record.effect === 'destructive';

    if (record.status === 'admitted') {
        finishExecution(runId, 'failed', { ok: false, code: 'INTERRUPTED', message: 'The start was never dispatched' }, clock.now());
        return { runId, status: 'failed', observed: false, reason: 'never dispatched' };
    }
    if (record.status !== 'running' && record.status !== 'uncertain') {
        return { runId, status: record.status, observed: false, reason: 'already settled' };
    }
    if (!record.externalRunId) {
        if (record.status === 'running') {
            const status = sideEffect ? 'uncertain' : 'failed';
            finishExecution(runId, status, {
                ok: false,
                code: sideEffect ? 'EFFECT_UNCERTAIN' : 'UNOBSERVABLE',
                message: `The start was dispatched and no external run id was recorded. ${UNOBSERVED}`
            }, clock.now());
            return { runId, status, observed: false, reason: 'no external run id' };
        }
        return { runId, status: record.status, observed: false, reason: 'no external run id' };
    }

    const manifest = readCapability(record.capabilityId);
    if (!manifest || manifest.digest !== record.manifestDigest || manifest.transport.kind !== 'async' || manifest.execution?.kind !== 'async_poll') {
        return { runId, status: record.status, observed: false, reason: 'the manifest that started this run is not installed' };
    }
    if (manifest.approval === 'denied' || manifest.approval === 'pending') {
        return { runId, status: record.status, observed: false, reason: `capability is ${manifest.approval}` };
    }
    const runtime = asyncRuntime(manifest.transport.runtimeId);
    if (!runtime) return { runId, status: record.status, observed: false, reason: 'runtime not bound' };
    const auth = applyAuth(manifest);
    if ('error' in auth) return { runId, status: record.status, observed: false, reason: 'credential slot is empty' };

    activeAsyncRuns.add(runId);
    try {
        const outcome = await pollUntilSettled({
            runtime,
            operation: manifest.transport.operation,
            externalRunId: record.externalRunId,
            headers: auth.headers,
            idempotencyKey: record.idempotencyKey,
            pollIntervalMs: manifest.execution.pollIntervalMs,
            deadlineAt: record.startedAt + manifest.execution.maxDurationMs,
            requestTimeoutMs: REQUEST_TIMEOUT_MS,
            clock,
            signal: options.signal,
            onObserve: (status, at) => observeExecution(runId, status, at)
        });
        const result = settleAsync(manifest, runId, outcome, record.status, clock.now(), auth.secret);
        const after = executionRecord(runId);
        return {
            runId,
            status: after?.status ?? record.status,
            observed: outcome.kind === 'succeeded' || outcome.kind === 'failed',
            result
        };
    } finally {
        activeAsyncRuns.delete(runId);
    }
}

/**
 * After a reload: every async run the ledger still shows open, and every
 * uncertain one with an external run id, is observed through that id.
 * Nothing is dispatched again.
 */
export async function recoverAsyncExecutions(
    options: { clock?: AsyncClock; signal?: AbortSignal } = {}
): Promise<ReconcileReport[]> {
    const open = executionRecords().filter(record =>
        record.executionProfile === 'async_poll'
        && (record.status === 'admitted' || record.status === 'running'
            || (record.status === 'uncertain' && record.externalRunId !== undefined))
        && !activeAsyncRuns.has(record.runId)
    );
    const reports: ReconcileReport[] = [];
    for (const record of open) reports.push(await reconcileAsyncExecution(record.runId, options));
    return reports;
}

function bounded(signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
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

    const checked = checkInput(manifest, input);
    if ('errors' in checked) {
        return finish(failure(capabilityId, 'INPUT_INVALID', checked.errors.join('; '), false));
    }

    const prepared = prepareRun(manifest, checked.args);
    if ('error' in prepared) {
        return finish(failure(capabilityId, 'INPUT_INVALID', prepared.error, false));
    }
    const run = prepared.run;
    if ((manifest.effect === 'write' || manifest.effect === 'destructive')
        && options.confirmedRun !== run.preview.digest) {
        return finish(failure(
            capabilityId,
            'CONFIRMATION_REQUIRED',
            `This ${manifest.effect} run was not confirmed as shown; review the request and confirm it`,
            false
        ));
    }

    const auth = applyAuth(manifest);
    if ('error' in auth) return finish(auth.error, undefined);

    if (options.idempotencyKey !== undefined && !/^[A-Za-z0-9._~-]{8,128}$/.test(options.idempotencyKey)) {
        return finish(failure(capabilityId, 'INPUT_INVALID', 'idempotency key is invalid', false));
    }
    const idempotencyKey = options.idempotencyKey
        ?? `once_${sha256(`${manifest.digest}|${Date.now()}|${Math.random()}`).slice(0, 32)}`;
    const profile = manifest.execution?.kind === 'async_poll' ? manifest.execution : undefined;
    const clock = options.clock ?? systemClock;
    const admission = admitExecution({
        capabilityId,
        manifestDigest: manifest.digest,
        effect: manifest.effect,
        // The digest of the exact request that will be sent (never the
        // credential), so any different request under the same key conflicts
        // instead of replaying.
        input: run.preview.digest,
        idempotencyKey,
        // An async job's budget is its profile, not the per-request timeout.
        deadlineMs: profile ? profile.maxDurationMs + REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS + 5_000,
        ...(profile ? { now: clock.now(), executionProfile: 'async_poll' as const } : {}),
        ...(manifest.provenance ? { providerId: manifest.provenance.providerId } : {}),
        observing: activeAsyncRuns
    });
    if (admission.kind !== 'admit') return replay(manifest, admission.record, admission.kind);
    if (profile) return executeAsync(manifest, profile, run.args, auth.headers, admission.record, idempotencyKey, options.signal, clock, auth.secret);

    const runId = admission.record.runId;
    const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
    let dispatched = false;

    try {
        if (options.signal?.aborted) {
            return finish(failure(capabilityId, 'CANCELED', 'Execution was canceled', false), runId, 'canceled');
        }
        const step = await dispatch(
            manifest,
            run,
            auth.headers,
            auth.query,
            options.fetchImpl ?? fetch,
            options.signal,
            idempotencyKey,
            auth.secret,
            () => {
                dispatched = true;
                markExecutionDispatched(runId);
            }
        );
        if (step.type === 'halt') {
            const uncertain = step.result.error?.code === 'EFFECT_UNCERTAIN';
            return finish(step.result, runId, uncertain ? 'uncertain' : 'failed');
        }
        const value = step.value;

        const schemaErrors = validateValue(manifest.output.schema, value);
        if (schemaErrors.length > 0) {
            return finish(dispatchedFailure(
                manifest,
                'TYPED_OUTPUT_MISMATCH',
                schemaErrors.slice(0, 6).join('; '),
                false,
                auth.secret
            ), runId, 'failed');
        }
        const typed: TypedValue = { schema: manifest.output.schema, value };
        return finish({
            ok: true,
            capabilityId,
            typed,
            presentation: projectSuccess(manifest, typed)
        }, runId, 'succeeded');
    } catch (error) {
        if (dispatched && sideEffect) {
            return finish(failure(
                capabilityId,
                'EFFECT_UNCERTAIN',
                'The call was dispatched and the outcome was not observed. Do not retry automatically.',
                false
            ), runId, 'uncertain');
        }
        const aborted = options.signal?.aborted || (error instanceof Error && error.name === 'AbortError');
        if (aborted) {
            return finish(failure(capabilityId, 'CANCELED', 'Execution was canceled', false), runId, 'canceled');
        }
        return finish(dispatchedFailure(
            manifest,
            'UPSTREAM_ERROR',
            error instanceof Error ? error.message : 'Unknown execution error',
            manifest.effect === 'read' || manifest.effect === 'compute',
            auth.secret
        ), runId, 'failed');
    }
}

/**
 * Read each declared input the caller supplied, once, as an own property, and
 * copy it into the JSON domain. That copy is validated, prepared, hashed and
 * dispatched; the caller's objects are not read again. An input left
 * undefined at the top level is not supplied. Inside a value, undefined and
 * every other value JSON cannot carry exactly is refused.
 */
function checkInput(
    manifest: CapabilityManifest,
    input: Record<string, unknown>
): { args: Readonly<Record<string, unknown>> } | { errors: string[] } {
    if (!isRecord(input)) return { errors: ['input must be an object'] };
    const errors: string[] = [];
    const known = new Set(manifest.inputs.map(entry => entry.name));
    for (const key of Object.keys(input)) {
        if (!known.has(key)) errors.push(`unexpected input ${key}`);
    }
    const args = Object.create(null) as Record<string, unknown>;
    for (const entry of manifest.inputs) {
        const supplied = Object.hasOwn(input, entry.name) ? input[entry.name] : undefined;
        if (supplied === undefined) {
            if (entry.required) errors.push(`${entry.name} is required`);
            continue;
        }
        const copied = toJsonValue(supplied, entry.name);
        if ('error' in copied) {
            errors.push(copied.error);
            continue;
        }
        errors.push(...validateValue(entry.schema, copied.value, entry.name));
        args[entry.name] = copied.value;
    }
    if (errors.length === 0 && manifest.transport.kind === 'http') {
        const target = resolveHttpPath(manifest.transport.baseUrl, manifest.transport.path, args);
        if ('error' in target) errors.push(target.error);
    }
    return errors.length > 0 ? { errors } : { args: Object.freeze(args) };
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
    if (auth.kind === 'bearer' || auth.kind === 'oauth') {
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
    run: PreparedRun,
    authHeaders: Record<string, string>,
    authQuery: Record<string, string>,
    fetchImpl: typeof fetch,
    signal: AbortSignal | undefined,
    idempotencyKey: string,
    secret: string | undefined,
    markDispatched: () => void
): Promise<Step> {
    if (manifest.transport.kind === 'http') {
        return executeHttp(manifest, run, authHeaders, authQuery, fetchImpl, signal, idempotencyKey, secret, markDispatched);
    }
    markDispatched();
    if (manifest.transport.kind === 'mcp') return executeMcp(manifest, run.args, authHeaders, signal);
    return executeLocal(manifest, run.args, signal);
}

function halt(result: CapabilityResult): Step {
    return { type: 'halt', result };
}

async function executeHttp(
    manifest: CapabilityManifest,
    run: PreparedRun,
    authHeaders: Record<string, string>,
    authQuery: Record<string, string>,
    fetchImpl: typeof fetch,
    signal: AbortSignal | undefined,
    idempotencyKey: string,
    secret: string | undefined,
    markDispatched: () => void
): Promise<Step> {
    if (manifest.transport.kind !== 'http' || !run.http) {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not an http capability', false));
    }
    // Sent exactly as prepared (and, for a write, as confirmed); only the
    // credential is added here.
    const url = new URL(run.http.url);
    const headers = Object.assign(
        Object.create(null) as Record<string, string>,
        { accept: 'application/json' },
        authHeaders,
        run.http.headers
    );
    for (const [key, value] of Object.entries(authQuery)) url.searchParams.set(key, value);

    const body = run.http.body;
    if (body !== undefined && !headers['content-type'] && !headers['Content-Type']) {
        headers['content-type'] = 'application/json';
    }

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    markDispatched();
    if (manifest.transport.access === 'server_broker') {
        return executeBroker(manifest, run.args, idempotencyKey, secret, fetchImpl, requestSignal);
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

async function executeLocal(manifest: CapabilityManifest, args: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<Step> {
    if (manifest.transport.kind !== 'local') {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not a local capability', false));
    }
    const handler = localHandlers.get(manifest.transport.handler);
    if (!handler) {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', `No local handler bound for ${manifest.transport.handler}`, false));
    }
    return { type: 'value', value: await handler(args, { signal }) };
}

async function executeBroker(
    manifest: CapabilityManifest,
    input: Readonly<Record<string, unknown>>,
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
        const code = typeof payload.error.code === 'string' && /^[A-Z_]{1,40}$/.test(payload.error.code)
            ? payload.error.code
            : 'UPSTREAM_ERROR';
        return halt(dispatchedFailure(manifest, code, payload.error.message || 'Broker request failed', false, secret));
    }
    if (!response.ok) {
        return halt(failure(manifest.id, 'UPSTREAM_ERROR', `Broker HTTP ${response.status}`, false));
    }
    return { type: 'value', value: payload.value };
}

async function executeMcp(
    manifest: CapabilityManifest,
    args: Readonly<Record<string, unknown>>,
    authHeaders: Record<string, string>,
    signal?: AbortSignal
): Promise<Step> {
    if (manifest.transport.kind !== 'mcp') {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', 'Not an mcp capability', false));
    }
    const transport = mcpTransports.get(manifest.transport.serverId);
    if (!transport) {
        return halt(failure(manifest.id, 'TRANSPORT_NOT_BOUND', `No MCP transport bound for ${manifest.transport.serverId}`, false));
    }
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return {
        type: 'value',
        value: await transport.call(
            manifest.transport.serverId,
            manifest.transport.toolName,
            args,
            requestSignal,
            { headers: { ...authHeaders } }
        )
    };
}

function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
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
            redact(record.receipt?.message ?? 'The call was dispatched and the outcome was not observed. Do not retry automatically.', slotSecret(manifest)),
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
        redact(record.receipt?.message ?? 'The previous run failed', slotSecret(manifest)),
        false
    ), record.runId);
}

function remembered(result: CapabilityResult, runId: string): CapabilityResult {
    result.runId = runId;
    return result;
}

function slotSecret(manifest: CapabilityManifest): string | undefined {
    return manifest.auth.kind !== 'none' && manifest.auth.secretRef
        ? capabilitySecrets.get(manifest.auth.secretRef)
        : undefined;
}

/**
 * A failure whose message came back from a dispatched call. The credential
 * is removed in every encoding it could have been sent in, and the message
 * is capped, before it reaches the result, its presentation or a receipt.
 */
function dispatchedFailure(
    manifest: CapabilityManifest,
    code: string,
    message: string,
    retryable: boolean,
    secret: string | undefined
): CapabilityResult {
    return failure(manifest.id, code, redact(message, secret ?? slotSecret(manifest)), retryable);
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

function receiptFor(result: CapabilityResult): ExecutionReceipt {
    return result.ok
        ? { ok: true, value: result.typed?.value }
        : { ok: false, code: result.error?.code, message: result.error?.message };
}

function finish(
    result: CapabilityResult,
    runId?: string,
    status?: Exclude<ExecutionPhase, 'admitted' | 'running'>,
    at?: number
): CapabilityResult {
    if (runId && status) {
        finishExecution(runId, status, receiptFor(result), at);
        result.runId = runId;
    }
    return result;
}
