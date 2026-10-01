// The host binds this runtime under `maxun`. The endpoint is host
// configuration; nothing in a manifest can change it. Each request is one
// bounded fetch with the caller's signal and no redirects, so the API key is
// never forwarded to another origin. The pinned cloud origin is the only host
// accepted without resolved addresses. Any other base has to pass the broker
// egress check, so a loopback, private, or metadata address never sees the key.
//
// Start is fenced. The async_poll profile needs a start that answers with a
// run id before the run finishes, so the id can be recorded and observed.
// Maxun's open-source server does not offer one: POST /api/robots/:id/runs
// awaits waitForRunCompletion before it answers (getmaxun/maxun
// server/src/api/record.ts, at e17d5ed33a3c90220fba54c78f449a1f55043cb9 and
// unchanged at develop bf3187eff7f644bfbcc1c130fb85bad332bbd420), and
// POST /api/sdk/robots/:id/execute waits the same way. Against that server a
// run longer than the 15 s request timeout aborts before its id is known, and
// a write is then uncertain with nothing to reconcile by. So start sends
// nothing and refuses, until an early-acknowledgement contract is verified.
// Maxun Cloud was not measured.
//
// Poll reads one run by id: GET /api/robots/:id/runs/:runId, which answers
// immediately with { statusCode, messageCode, run } in that source. No live
// account was used to check it.

import { AsyncStartRejected, type AsyncJobRuntime, type AsyncObservation } from '../asyncRuntime';
import { assessEgress, type ResolvedAddress } from '../egress';
import { isRecord } from '../valueType';
import { MAXUN_API_KEY_HEADER, parseMaxunOperation, type MaxunRobotMode } from './maxunProvider';

export const MAXUN_CLOUD_BASE_URL = 'https://app.maxun.dev';

export const MAXUN_START_UNAVAILABLE =
    'Maxun has no verified asynchronous start contract: its run start answers only when the run finishes. No request was sent.';

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
        async start() {
            throw new AsyncStartRejected(MAXUN_START_UNAVAILABLE);
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
