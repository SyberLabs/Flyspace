// ============================================
// REGISTRY INTENT: ask JEV which intent a search is about.
//
// One TypeSafe System One call with a single `choice` question whose options
// are the host's intent ids (registryIntents.ts). JEV returns a probability
// per option; nothing else from the response is used. Every option id in the
// answer must be one the host offered, and every probability a number in
// [0, 1]: an answer that names anything else is refused, not trusted
// (MasterMind DECISION_PROVIDER_CONTRACT: reject out-of-set candidate ids,
// validate strict schema, keep a deterministic fallback).
//
// Only the search text leaves the machine. No canvas data, no user identity.
// ============================================

import 'server-only';
import { intentCriteria, REGISTRY_INTENTS } from '@/core/capabilities/registryIntents';
import type { IntentScore } from '@/core/capabilities/registryRanking';

export const TYPESAFE_SYSTEMONE_URL = 'https://api.typesafe.ai/v1/systemone';
export const TYPESAFE_MODEL = 'jev-latest';
/** jev-latest resolves to a versioned build, e.g. `jev-1.13.0`. */
const RESOLVED_MODEL = /^jev-\d+\.\d+(\.\d+)?$/;

export const MAX_QUERY_CHARS = 200;
export const INTENT_DEADLINE_MS = 8000;

const INSTRUCTIONS =
    'Which kind of API is this person looking for? Choose the closest option. '
    + 'This only routes a search; it does not answer the request.';

export type IntentFailure =
    | 'not_configured'
    | 'query_invalid'
    | 'timeout'
    | 'unreachable'
    | 'upstream_status'
    | 'upstream_shape';

export type IntentOutcome =
    | { ok: true; scores: IntentScore[]; model: string }
    | { ok: false; failure: IntentFailure };

export interface ClassifyOptions {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}

/** A search the route will forward: one line of real text, bounded. */
export function normalizeQuery(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const query = value.replace(/\s+/g, ' ').trim();
    if (query.length === 0 || query.length > MAX_QUERY_CHARS) return null;
    return query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the scores out of a System One response, or refuse it. Strict: the
 * answer must be a `choice`, its `choice` an offered id, and its
 * `probabilities` only offered ids with numbers in [0, 1].
 */
export function readIntentAnswer(body: unknown, offered: ReadonlySet<string>): { scores: IntentScore[]; model: string } | null {
    if (!isRecord(body) || typeof body.model !== 'string' || !RESOLVED_MODEL.test(body.model)) return null;
    if (!isRecord(body.answers)) return null;
    const answer = body.answers.intent;
    if (!isRecord(answer) || answer.type !== 'choice') return null;
    if (typeof answer.choice !== 'string' || !offered.has(answer.choice)) return null;
    if (!isRecord(answer.probabilities)) return null;

    const scores: IntentScore[] = [];
    for (const [id, p] of Object.entries(answer.probabilities)) {
        if (!offered.has(id)) return null;
        if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) return null;
        scores.push({ id, p });
    }
    if (scores.length === 0) return null;
    scores.sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1));
    return { scores, model: body.model };
}

export async function classifyIntent(rawQuery: unknown, options: ClassifyOptions = {}): Promise<IntentOutcome> {
    const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) return { ok: false, failure: 'not_configured' };
    const query = normalizeQuery(rawQuery);
    if (!query) return { ok: false, failure: 'query_invalid' };

    const criteria = intentCriteria(REGISTRY_INTENTS);
    const offered = new Set(Object.keys(criteria));
    const deadline = AbortSignal.timeout(INTENT_DEADLINE_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;

    let response: Response;
    try {
        response = await (options.fetchImpl ?? fetch)(TYPESAFE_SYSTEMONE_URL, {
            method: 'POST',
            redirect: 'error',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                model: TYPESAFE_MODEL,
                state: query,
                questions: { intent: { type: 'choice', instructions: INSTRUCTIONS, criteria } }
            }),
            signal
        });
    } catch (err) {
        const name = err instanceof Error ? err.name : '';
        return { ok: false, failure: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable' };
    }
    if (!response.ok) return { ok: false, failure: 'upstream_status' };

    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return { ok: false, failure: 'upstream_shape' };
    }
    const answer = readIntentAnswer(body, offered);
    return answer ? { ok: true, ...answer } : { ok: false, failure: 'upstream_shape' };
}
