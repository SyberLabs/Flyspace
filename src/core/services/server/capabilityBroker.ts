// Server fetch broker.
// The client sends a manifest. The server rebuilds the URL from that manifest,
// checks egress, and connects to the resolved public address. It does not
// accept a free-form URL, and it does not perform write or destructive calls:
// approval lives on the client, so a brokered write would be self-approval.

import { assessEgress } from '@/core/capabilities/egress';
import { canonicalize, sha256 } from '@/core/capabilities/hash';
import { resolveHttpPath } from '@/core/capabilities/httpTarget';
import { redact } from '@/core/capabilities/redact';
import { validateManifest, type CapabilityManifest } from '@/core/capabilities/manifest';
import { isBlockedDestination } from './egressBlockList';
import type { PinnedRequest, PinnedResponse } from './pinnedFetch';
import type { ServerExecution, ServerLedger } from './capability.ledger';

const MAX_BODY = 1_000_000;
/** Total budget for one broker request, from route entry to the last upstream byte. */
export const BROKER_DEADLINE_MS = 15_000;
const WINDOW_MS = 60_000;
const MAX_PER_CALLER = 30;
const MAX_GLOBAL = 120;

export interface BrokerRateLimiter {
    allow(caller: string, now: number): boolean;
}

/**
 * A sliding one-minute window per caller, under one global window for the
 * process. Entries outside the window are pruned on every call, so the map
 * holds at most the callers admitted in the last minute (no more than the
 * global cap). Per process: a multi-instance deployment needs a shared store.
 */
export function createBrokerRateLimiter(perCaller = MAX_PER_CALLER, global = MAX_GLOBAL): BrokerRateLimiter {
    const hits = new Map<string, number[]>();
    let all: number[] = [];
    return {
        allow(caller, now) {
            const live = (at: number) => now - at < WINDOW_MS;
            all = all.filter(live);
            for (const [key, times] of hits) {
                const kept = times.filter(live);
                if (kept.length === 0) hits.delete(key);
                else hits.set(key, kept);
            }
            const recent = hits.get(caller) ?? [];
            if (all.length >= global || recent.length >= perCaller) return false;
            recent.push(now);
            hits.set(caller, recent);
            all.push(now);
            return true;
        }
    };
}

const processLimiter = createBrokerRateLimiter();

/** Proof that one request was already counted against the broker budget. Spent once. */
export interface BrokerAdmission {
    readonly caller: string;
}

const issuedAdmissions = new WeakSet<BrokerAdmission>();

/**
 * Count one request against the caller's and the global budget, before any
 * of its body is read. Null means refuse it with 429. The route calls this
 * first and hands the result to `handleCapabilityBroker`, which then does
 * not count the same request again.
 */
export function admitBrokerCaller(
    caller: string,
    options: { limiter?: BrokerRateLimiter; now?: () => number } = {}
): BrokerAdmission | null {
    if (!(options.limiter ?? processLimiter).allow(caller, options.now?.() ?? Date.now())) return null;
    const admission = Object.freeze({ caller });
    issuedAdmissions.add(admission);
    return admission;
}

function spend(admission: BrokerAdmission | undefined, caller: string): boolean {
    if (!admission || !issuedAdmissions.has(admission)) return false;
    issuedAdmissions.delete(admission);
    return admission.caller === caller;
}

export interface BrokerDeps {
    ledger: ServerLedger;
    resolve: (hostname: string) => Promise<string[]>;
    fetch: (request: PinnedRequest) => Promise<PinnedResponse>;
    now?: () => number;
    /** Aborts on client disconnect or the total deadline. Defaults to the deadline alone. */
    signal?: AbortSignal;
    /** Who is asking. The client address until the broker authenticates callers. */
    caller?: string;
    limiter?: BrokerRateLimiter;
    /** From `admitBrokerCaller`, when the request was counted before its body was read. */
    admission?: BrokerAdmission;
}

export async function handleCapabilityBroker(
    body: unknown,
    deps: BrokerDeps
): Promise<{ status: number; body: unknown }> {
    const signal = deps.signal ?? AbortSignal.timeout(BROKER_DEADLINE_MS);
    // Counted before parsing: the budget belongs to the caller, not to a
    // manifest the caller chose. A request the route already counted, before
    // reading its body, is not counted twice.
    const caller = deps.caller ?? 'local';
    if (!spend(deps.admission, caller) && !admitBrokerCaller(caller, { limiter: deps.limiter, now: deps.now })) {
        return json(429, 'broker rate limit exceeded');
    }
    const parsed = parseBody(body);
    if ('error' in parsed) return json(400, parsed.error);
    const { manifest, input, idempotencyKey, secret } = parsed;

    if (manifest.transport.kind !== 'http' || manifest.transport.access !== 'server_broker') {
        return json(400, 'broker only accepts server_broker http capabilities');
    }
    if (manifest.effect === 'write' || manifest.effect === 'destructive') {
        return json(403, 'broker refuses write and destructive capabilities');
    }
    if (manifest.approval !== 'auto') {
        return json(403, 'broker capability is not approved to run');
    }

    let url: URL;
    try {
        url = buildUrl(manifest, input);
    } catch {
        return json(400, 'broker URL could not be built');
    }
    // The URL is everything the caller's input changes in the request this
    // broker sends, so the run is keyed on it, taken before the credential
    // is added: the ledger holds nothing derived from the secret.
    const inputDigest = sha256(canonicalize({ method: manifest.transport.method, url: url.toString() }));

    if (manifest.auth.kind === 'apiKey' && manifest.auth.in === 'query' && manifest.auth.name && secret) {
        url.searchParams.set(manifest.auth.name, `${manifest.auth.prefix ?? ''}${secret}`);
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIp(host) ? [host] : await untilAborted(() => deps.resolve(host), signal).catch(() => [] as string[]);
    if (signal.aborted) return json(504, { error: { code: 'DEADLINE', message: DEADLINE_PASSED } });
    const egress = assessEgress(url, addresses.map(address => ({ address })));
    if (!egress.ok) return json(403, egress.reason);
    if (addresses.some(isBlockedDestination)) return json(403, 'broker host is not a public address');

    const runId = `run_${sha256(`${manifest.digest}|${idempotencyKey}`).slice(0, 16)}`;
    const row: ServerExecution = {
        runId,
        capabilityId: manifest.id,
        manifestDigest: manifest.digest,
        effect: manifest.effect,
        inputDigest,
        idempotencyKey,
        status: 'admitted'
    };
    const admission = await deps.ledger.admit(row);
    if (admission.kind !== 'new') {
        return json(admission.kind === 'conflict' ? 409 : 200, {
            replayed: true,
            executionStatus: admission.row.status,
            runId: admission.row.runId,
            error: admission.kind === 'conflict'
                ? { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key was already used for a different input' }
                : admission.row.error
                    ? {
                        code: admission.row.status === 'uncertain' ? 'EFFECT_UNCERTAIN' : storedCode(admission.row.error),
                        message: 'The previous run failed'
                    }
                    : undefined
        });
    }

    // The caller may have gone, or the deadline passed, while the ledger was
    // busy. Nothing has been sent yet, so the run is canceled, not failed.
    if (signal.aborted) {
        await deps.ledger.finish(admission.row.runId, 'canceled');
        return json(504, { runId: admission.row.runId, executionStatus: 'canceled', error: { code: 'DEADLINE', message: DEADLINE_PASSED } });
    }
    await deps.ledger.markDispatched(admission.row.runId);
    const headers = applyAuth(manifest, secret);
    const method = manifest.transport.method;
    try {
        const response = await untilAborted(() => deps.fetch({
            url,
            address: addresses[0],
            method,
            headers,
            signal,
            maxBytes: MAX_BODY
        }), signal);
        if (response.status >= 300 && response.status < 400) {
            await deps.ledger.finish(admission.row.runId, 'failed', 'HTTP_REDIRECT_REFUSED');
            return failed(502, admission.row.runId, 'HTTP_REDIRECT_REFUSED', 'Redirects are not followed', secret);
        }
        if (response.status < 200 || response.status >= 300) {
            await deps.ledger.finish(admission.row.runId, 'failed', 'HTTP_ERROR');
            return failed(502, admission.row.runId, 'HTTP_ERROR', `HTTP ${response.status}`, secret);
        }
        const value = response.text.trim() === '' ? null : JSON.parse(response.text) as unknown;
        await deps.ledger.finish(admission.row.runId, 'succeeded');
        return json(200, { runId: admission.row.runId, executionStatus: 'succeeded', value });
    } catch {
        if (signal.aborted) {
            await deps.ledger.finish(admission.row.runId, 'failed', 'DEADLINE');
            return failed(504, admission.row.runId, 'DEADLINE', DEADLINE_PASSED, secret);
        }
        // The transport's own error text describes the destination's network
        // (refused, reset, certificate). None of it goes back to the caller.
        await deps.ledger.finish(admission.row.runId, 'failed', 'UPSTREAM_ERROR');
        return failed(502, admission.row.runId, 'UPSTREAM_ERROR', UPSTREAM_FAILED, secret);
    }
}

const UPSTREAM_FAILED = 'The upstream request failed';

/**
 * The ledger's error column holds a code, never upstream text. Rows written
 * before that rule may hold text; it is not echoed back.
 */
function storedCode(error: string): string {
    return /^[A-Z_]{1,40}$/.test(error) ? error : 'UPSTREAM_ERROR';
}

function failed(status: number, runId: string, code: string, message: string, secret: string | undefined) {
    return json(status, { runId, executionStatus: 'failed', error: { code, message: redact(message, secret) } });
}
const DEADLINE_PASSED = 'The broker request did not finish within its deadline';

/**
 * Start the work only if the signal has not aborted, then settle with it or
 * reject when the signal aborts, whichever comes first. Work is never started
 * after an abort, and once started, Promise.race observes its outcome, so a
 * late rejection is never left unhandled.
 */
function untilAborted<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    let work: Promise<T>;
    try {
        work = start();
    } catch (error) {
        return Promise.reject(error);
    }
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    return Promise.race([work, aborted]).finally(() => signal.removeEventListener('abort', onAbort));
}

function parseBody(body: unknown): {
    manifest: CapabilityManifest;
    input: Record<string, unknown>;
    idempotencyKey: string;
    secret?: string;
} | { error: string } {
    if (!body || typeof body !== 'object') return { error: 'broker body must be an object' };
    const record = body as Record<string, unknown>;
    const validated = validateManifest(record.manifest);
    if (!validated.ok || !validated.manifest) return { error: validated.errors.join('; ') };
    if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) {
        return { error: 'broker input must be an object' };
    }
    if (typeof record.idempotencyKey !== 'string' || !/^[A-Za-z0-9._~-]{8,128}$/.test(record.idempotencyKey)) {
        return { error: 'broker idempotency key is invalid' };
    }
    const secret = typeof record.secret === 'string' ? record.secret : undefined;
    return {
        manifest: validated.manifest,
        input: record.input as Record<string, unknown>,
        idempotencyKey: record.idempotencyKey,
        ...(secret ? { secret } : {})
    };
}

function buildUrl(manifest: CapabilityManifest, input: Record<string, unknown>): URL {
    if (manifest.transport.kind !== 'http') throw new Error('not http');
    const target = resolveHttpPath(manifest.transport.baseUrl, manifest.transport.path, input);
    if ('error' in target) throw new Error(target.error);
    const url = target.url;
    for (const entry of manifest.inputs) {
        if (!Object.hasOwn(input, entry.name) || input[entry.name] === undefined || entry.in !== 'query') continue;
        const value = input[entry.name];
        url.searchParams.set(entry.name, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return url;
}

function applyAuth(manifest: CapabilityManifest, secret: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (manifest.auth.kind === 'none' || !secret) return headers;
    if (manifest.auth.kind === 'bearer') headers.authorization = `Bearer ${secret}`;
    else if (manifest.auth.kind === 'basic') headers.authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
    else if (manifest.auth.kind === 'apiKey' && manifest.auth.name && manifest.auth.in !== 'query') {
        headers[manifest.auth.name] = `${manifest.auth.prefix ?? ''}${secret}`;
    }
    return headers;
}

function isIp(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function json(status: number, body: unknown): { status: number; body: unknown } {
    return { status, body: typeof body === 'string' ? { error: body } : body };
}
