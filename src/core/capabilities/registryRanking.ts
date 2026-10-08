// ============================================
// REGISTRY RANKING: JEV's intent probabilities → an ordered result list.
//
// Host-side and deterministic. JEV supplies only a probability per intent id;
// this decides what to show. Results from a confident intent come first (its
// hand-checked APIs, then a keyword search on its terms), then the keyword
// results for the query itself, so a literal query still finds what keyword
// search found. With no JEV answer, or when JEV says "none of these", the
// result is plain keyword search: routing can add results, never hide them.
// ============================================

import { isUsableEntry, type ApiIndexEntry } from './apiIndex';
import { DEFAULT_RESULT_LIMIT, type ApiSearcher } from './registrySearch';
import { OTHER_INTENT, REGISTRY_INTENTS, type RegistryIntent } from './registryIntents';

/** An intent counts once JEV gives it at least this probability. */
export const MIN_INTENT_PROBABILITY = 0.15;
/** At most this many intents shape one result list. */
export const MAX_ROUTED_INTENTS = 2;
/** JEV is confident nothing listed fits: keyword search alone. */
export const OTHER_CUTOFF = 0.5;
/** Keyword results taken per routed intent's terms. */
const TERMS_PER_INTENT = 5;

export interface IntentScore {
    id: string;
    p: number;
}

export interface RankedResult {
    entry: ApiIndexEntry;
    /** Why it is here: a routed intent, or the keyword search on the query. */
    source: 'intent' | 'keyword';
    intent?: string;
}

export interface RankOptions {
    limit?: number;
    intents?: readonly RegistryIntent[];
}

/** The intents worth routing to, most likely first. Empty means keyword only. */
export function routedIntents(scores: readonly IntentScore[] | null): IntentScore[] {
    if (!scores || scores.length === 0) return [];
    const other = scores.find(s => s.id === OTHER_INTENT);
    if (other && other.p >= OTHER_CUTOFF) return [];
    return scores
        .filter(s => s.id !== OTHER_INTENT && Number.isFinite(s.p) && s.p >= MIN_INTENT_PROBABILITY)
        .sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1))
        .slice(0, MAX_ROUTED_INTENTS);
}

/** Routed intents no usable API answers yet, with the reason, for search to say plainly. */
export function unavailableIntents(
    scores: readonly IntentScore[] | null,
    intents: readonly RegistryIntent[] = REGISTRY_INTENTS
): { id: string; reason: string }[] {
    const catalog = new Map(intents.map(intent => [intent.id, intent]));
    return routedIntents(scores).flatMap(score => {
        const reason = catalog.get(score.id)?.unavailable;
        return reason ? [{ id: score.id, reason }] : [];
    });
}

export function rankResults(
    query: string,
    searcher: ApiSearcher,
    byId: ReadonlyMap<string, ApiIndexEntry>,
    scores: readonly IntentScore[] | null,
    options: RankOptions = {}
): RankedResult[] {
    const limit = options.limit ?? DEFAULT_RESULT_LIMIT;
    const catalog = new Map((options.intents ?? REGISTRY_INTENTS).map(intent => [intent.id, intent]));
    const results: RankedResult[] = [];
    const seen = new Set<string>();
    const add = (entry: ApiIndexEntry | undefined, source: RankedResult['source'], intent?: string) => {
        if (!entry || seen.has(entry.id) || results.length >= limit) return;
        seen.add(entry.id);
        results.push(intent ? { entry, source, intent } : { entry, source });
    };

    for (const score of routedIntents(scores)) {
        const intent = catalog.get(score.id);
        // An id JEV returned that is not in the host's list is ignored, not trusted.
        if (!intent) continue;
        // Nothing usable answers it: say so (unavailableIntents) rather than
        // padding the list with keyword matches for its terms.
        if (intent.unavailable) continue;
        // A curated API that compiles to nothing is not offered as the answer; keyword search still finds it.
        for (const id of intent.apis) {
            const entry = byId.get(id);
            if (entry && isUsableEntry(entry)) add(entry, 'intent', intent.id);
        }
        for (const hit of searcher.search(intent.terms, TERMS_PER_INTENT)) add(hit.entry, 'intent', intent.id);
    }
    for (const hit of searcher.search(query, limit)) add(hit.entry, 'keyword');
    return results;
}

// ============================================
// CLIENT CALL
// ============================================

export const REGISTRY_INTENT_ENDPOINT = '/api/registry-intent';

export interface IntentAnswer {
    scores: IntentScore[];
    model: string;
}

/**
 * Ask the server for JEV's intent probabilities. `null` on any failure or
 * when the feature is off: the caller then shows keyword results, which is a
 * complete answer on its own.
 */
export async function fetchIntentScores(
    query: string,
    fetchImpl: typeof fetch = globalThis.fetch,
    signal?: AbortSignal
): Promise<IntentAnswer | null> {
    try {
        const response = await fetchImpl(REGISTRY_INTENT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
            signal
        });
        if (!response.ok) return null;
        const body: unknown = await response.json();
        if (!body || typeof body !== 'object') return null;
        const { scores, model } = body as { scores?: unknown; model?: unknown };
        if (!Array.isArray(scores) || typeof model !== 'string') return null;
        const clean = scores.filter((s): s is IntentScore =>
            !!s && typeof s === 'object'
            && typeof (s as IntentScore).id === 'string'
            && typeof (s as IntentScore).p === 'number' && Number.isFinite((s as IntentScore).p));
        return { scores: clean, model };
    } catch {
        return null;
    }
}
