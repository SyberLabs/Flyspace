// The host binds this runtime under `maxun`. It starts a robot run and reads
// the run back over Maxun's REST API, because the MCP `run_robot` tool holds
// one request open until the robot finishes. The endpoint is host
// configuration; nothing in a manifest can change it. Each request is one
// bounded fetch with the caller's signal and no redirects, so the API key is
// never forwarded to another origin. The pinned cloud origin is the only host
// accepted without resolved addresses. Any other base has to pass the broker
// egress check, so a loopback, private, or metadata address never sees the key.
//
// The request and response shapes follow Maxun's public docs. They were not
// checked against a live account in this environment.

import { AsyncStartRejected, type AsyncJobRuntime, type AsyncObservation } from '../asyncRuntime';
import { assessEgress, type ResolvedAddress } from '../egress';
import { isRecord } from '../valueType';
import { MAXUN_API_KEY_HEADER, parseMaxunOperation, type MaxunRobotMode } from './maxunProvider';

export const MAXUN_CLOUD_BASE_URL = 'https://app.maxun.dev';

const MAX_RESPONSE_CHARS = 1_000_000;
const RUNNING = new Set(['queued', 'scheduled', 'pending', 'running', 'in_progress']);
const SUCCEEDED = new Set(['success', 'succeeded', 'completed']);
const FAILED = new Set(['failed', 'error', 'aborted', 'canceled', 'cancelled']);

export interface MaxunRuntimeConfig {
    baseUrl?: string;
    fetch?: typeof fetch;
    /**
     * Addresses the caller already resolved for `baseUrl`. Required for any
     * host other than the pinned cloud origin, unless the host is an IP literal
     * the egress check can classify on its own. Missing answers are a refusal.
     */
    addresses?: ResolvedAddress[];
}

export function createMaxunRuntime(config: MaxunRuntimeConfig = {}): AsyncJobRuntime {
    const base = hostBase(config.baseUrl ?? MAXUN_CLOUD_BASE_URL, config.addresses ?? []);
    const fetchImpl = config.fetch ?? fetch;

    return {
        async start(operation, _args, call) {
            const parsed = operationOf(operation);
            const response = await fetchImpl(`${base}/api/robots/${encodeURIComponent(parsed.robotId)}/runs`, {
                method: 'POST',
                headers: { ...onlyKey(call.headers), Accept: 'application/json' },
                signal: call.signal,
                redirect: 'error'
            });
            // 408 and 409 do not say the run was not created, so they stay ambiguous.
            if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409) {
                throw new AsyncStartRejected(`Maxun refused the run: HTTP ${response.status}`);
            }
            if (!response.ok) throw new Error(`Maxun start failed: HTTP ${response.status}`);
            const body = await readJson(response);
            const run = runOf(body);
            const runId = run?.runId;
            if (typeof runId !== 'string') throw new Error('Maxun start returned no runId');
            return { externalRunId: runId };
        },

        async poll(operation, externalRunId, call): Promise<AsyncObservation> {
            const parsed = operationOf(operation);
            const url = `${base}/api/robots/${encodeURIComponent(parsed.robotId)}/runs/${encodeURIComponent(externalRunId)}`;
            const response = await fetchImpl(url, {
                method: 'GET',
                headers: { ...onlyKey(call.headers), Accept: 'application/json' },
                signal: call.signal,
                redirect: 'error'
            });
            if (!response.ok) throw new Error(`Maxun run lookup failed: HTTP ${response.status}`);
            const run = runOf(await readJson(response));
            if (!run || (run.runId !== undefined && run.runId !== externalRunId)) {
                throw new Error('Maxun returned a different run');
            }
            const status = typeof run.status === 'string' ? run.status.toLowerCase() : '';
            if (RUNNING.has(status)) return { status: 'running' };
            if (FAILED.has(status)) {
                return { status: 'failed', message: typeof run.error === 'string' ? run.error.slice(0, 500) : `Maxun run ${status}` };
            }
            if (SUCCEEDED.has(status)) return { status: 'succeeded', value: valueFor(parsed.mode, run.data) };
            throw new Error(`Maxun run status ${status || '(missing)'} is not understood`);
        }
    };
}

/** The value the manifest's output schema checks. Missing parts stay missing, so a mismatch is visible. */
function valueFor(mode: MaxunRobotMode, data: unknown): unknown {
    if (!isRecord(data)) return data;
    if (mode === 'scrape') return { markdown: data.markdown };
    return isRecord(data.textData) ? { ...data.textData } : data.textData;
}

function runOf(body: unknown): Record<string, unknown> | undefined {
    if (!isRecord(body)) return undefined;
    if (typeof body.runId === 'string') return body;
    if (isRecord(body.run) && typeof body.run.runId === 'string') return body.run;
    return undefined;
}

function operationOf(operation: string): { mode: MaxunRobotMode; robotId: string } {
    const parsed = parseMaxunOperation(operation);
    if (!parsed) throw new AsyncStartRejected(`${operation} is not a Maxun robot operation`);
    return parsed;
}

function onlyKey(headers: Record<string, string>): Record<string, string> {
    const value = headers[MAXUN_API_KEY_HEADER];
    return value ? { [MAXUN_API_KEY_HEADER]: value } : {};
}

function hostBase(raw: string, addresses: ResolvedAddress[]): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error('Maxun base URL is invalid');
    }
    if (url.protocol !== 'https:') throw new Error('Maxun base URL must be https');
    if (url.username || url.password) throw new Error('Maxun base URL cannot embed credentials');
    if (url.search || url.hash) throw new Error('Maxun base URL cannot carry a query or fragment');
    // The pinned origin is the product default. It does not need a DNS answer.
    // Every other host goes through assessEgress, which classifies literals
    // and refuses a name that was not resolved to public addresses.
    if (url.origin !== new URL(MAXUN_CLOUD_BASE_URL).origin) {
        const decision = assessEgress(url, addresses);
        if (!decision.ok) throw new Error(`Maxun base URL is refused: ${decision.reason}`);
    }
    return url.toString().replace(/\/+$/, '');
}

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new Error('Maxun response is too large');
    try {
        return JSON.parse(text);
    } catch {
        throw new Error('Maxun response is not JSON');
    }
}
