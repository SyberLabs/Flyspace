// ============================================
// REGISTRY SEARCH: find the right spec, then fetch it safely.
//
// The two steps in front of the OpenAPI provider. Search is deterministic
// keyword scoring over the API index (title, id, categories, description),
// instant and keyless. A JEV re-rank of the top results is a separate,
// optional step; when it is unavailable this order stands on its own.
//
// Fetching follows the index's trust boundary: only an https JSON spec on
// the catalog host, only for an entry the compiler can accept, with a size
// and time bound, no redirects and no credentials. The fetched document then
// goes to `openapiProvider` exactly as a pasted one would, so admission,
// effect policy and the install review are unchanged.
// ============================================

import { isCatalogSpecUrl, isUsableEntry, parseApiIndex, type ApiIndex, type ApiIndexEntry } from './apiIndex';
import { curatedApi } from './curatedApis';

/** Results kept per search; also the candidate set a re-rank may reorder. */
export const DEFAULT_RESULT_LIMIT = 24;

/** Largest spec the browser will download and compile. */
export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
export const SPEC_FETCH_TIMEOUT_MS = 15_000;

/** Where the static index is served from (public/api-index.json). */
export const API_INDEX_PATH = '/api-index.json';

// Field weights. A word in the title is the strongest signal of what an API
// is; an id names the provider (`stripe.com`); categories are curated; a
// description is long and noisy, so a hit there counts least.
const WEIGHTS = { title: 4, id: 3, category: 2, description: 1 } as const;

const STOP_WORDS = new Set([
    'a', 'an', 'and', 'api', 'apis', 'for', 'from', 'get', 'i', 'in', 'is', 'me', 'of',
    'on', 'or', 'the', 'to', 'want', 'with', 'my', 'that', 'this', 'data', 'service'
]);

export interface SearchResult {
    entry: ApiIndexEntry;
    score: number;
}

/** Lower-cased word tokens, minus stop words and one-letter fragments. */
export function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

interface Fields {
    title: Set<string>;
    id: Set<string>;
    category: Set<string>;
    description: Set<string>;
}

function fieldsOf(entry: ApiIndexEntry): Fields {
    return {
        title: new Set(tokenize(entry.title)),
        id: new Set(tokenize(entry.id)),
        category: new Set(entry.categories.flatMap(c => tokenize(c))),
        description: new Set(tokenize(entry.description))
    };
}

/** A query token matches a field word exactly, or as a prefix of 3+ letters ("weath" → "weather"). */
function matches(words: Set<string>, token: string): boolean {
    if (words.has(token)) return true;
    if (token.length < 3) return false;
    for (const word of words) {
        if (word.startsWith(token)) return true;
    }
    return false;
}

export interface ApiSearcher {
    search(query: string, limit?: number): SearchResult[];
}

/**
 * Index the entries once. Tokenizing 2.5k entries per keystroke would cost
 * ~18 ms a query; the searcher keeps the word sets and only scores.
 */
/** How much an entry that gives nothing to place counts against one that does. */
const UNUSABLE_WEIGHT = 0.5;

export function createApiSearcher(entries: readonly ApiIndexEntry[]): ApiSearcher {
    const fields = entries.map(fieldsOf);

    const containing = (token: string): number => {
        let n = 0;
        for (const f of fields) {
            if (matches(f.title, token) || matches(f.id, token) || matches(f.category, token) || matches(f.description, token)) n++;
        }
        return n;
    };

    return {
        /**
         * Rank entries for a free-text query. A token is weighted by how rare
         * it is across the index (IDF), so "weather" outweighs a word every
         * cloud API shares. Ties break toward installable entries, then by
         * id, so the order is stable.
         */
        search(query, limit = DEFAULT_RESULT_LIMIT) {
            const tokens = [...new Set(tokenize(query))];
            if (tokens.length === 0) return [];
            const idf = tokens.map(token => Math.log(1 + entries.length / (1 + containing(token))));

            const results: SearchResult[] = [];
            entries.forEach((entry, i) => {
                const f = fields[i];
                let score = 0;
                let matched = 0;
                tokens.forEach((token, t) => {
                    const best = Math.max(
                        matches(f.title, token) ? WEIGHTS.title : 0,
                        matches(f.id, token) ? WEIGHTS.id : 0,
                        matches(f.category, token) ? WEIGHTS.category : 0,
                        matches(f.description, token) ? WEIGHTS.description : 0
                    );
                    if (best > 0) {
                        score += best * idf[t];
                        matched++;
                    }
                });
                if (score === 0) return;
                // An entry that matches every query word beats one that
                // matches a single word strongly.
                score *= matched / tokens.length;
                // One you cannot install still shows, with its reason, but a
                // usable API that matches about as well comes first.
                if (!isUsableEntry(entry)) score *= UNUSABLE_WEIGHT;
                results.push({ entry, score });
            });

            results.sort((a, b) =>
                b.score - a.score
                || Number(isUsableEntry(b.entry)) - Number(isUsableEntry(a.entry))
                || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
            return results.slice(0, Math.max(0, limit));
        }
    };
}

/** One-shot search. Prefer `createApiSearcher` when searching the same index repeatedly. */
export function searchApiIndex(
    entries: readonly ApiIndexEntry[],
    query: string,
    limit: number = DEFAULT_RESULT_LIMIT
): SearchResult[] {
    return createApiSearcher(entries).search(query, limit);
}

// ============================================
// FETCH
// ============================================

export type RegistryFetchCode =
    | 'unsupported_version'
    | 'not_catalog_url'
    | 'timeout'
    | 'unreachable'
    | 'status'
    | 'too_large'
    | 'not_json';

export class RegistryFetchError extends Error {
    constructor(readonly code: RegistryFetchCode, message: string) {
        super(message);
        this.name = 'RegistryFetchError';
    }
}

export interface FetchOptions {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    maxBytes?: number;
    timeoutMs?: number;
}

async function readBoundedText(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new RegistryFetchError('too_large', `spec is ${declared} bytes; the limit is ${maxBytes}`);
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            if (signal.aborted) throw signal.reason;
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                throw new RegistryFetchError('too_large', `spec exceeds ${maxBytes} bytes`);
            }
            chunks.push(value);
        }
    } catch (err) {
        await reader.cancel().catch(() => undefined);
        throw err;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function isTimeout(err: unknown): boolean {
    return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

/**
 * Fetch an entry's spec document for `openapiProvider`. Refuses an entry the
 * compiler cannot accept before any request, and a URL off the catalog host
 * even if the index was tampered with after it loaded.
 */
export async function fetchCatalogSpec(entry: ApiIndexEntry, options: FetchOptions = {}): Promise<unknown> {
    // A curated spec ships in the bundle: nothing to fetch. Looked up by id in
    // the repo's own list, so an entry cannot claim a spec it does not have.
    const curated = entry.curated ? curatedApi(entry.id) : undefined;
    if (curated) return structuredClone(curated.spec);
    if (!entry.supported) {
        throw new RegistryFetchError('unsupported_version', `${entry.title} is Swagger ${entry.openapiVersion}; only OpenAPI 3.x can be installed`);
    }
    if (!isCatalogSpecUrl(entry.specUrl)) {
        throw new RegistryFetchError('not_catalog_url', `${entry.title} has a spec URL outside the catalog`);
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const timeout = AbortSignal.timeout(options.timeoutMs ?? SPEC_FETCH_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
        response = await fetchImpl(entry.specUrl, {
            redirect: 'error',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            headers: { Accept: 'application/json' },
            signal
        });
    } catch (err) {
        if (isTimeout(err)) throw new RegistryFetchError('timeout', `${entry.title}: no response in time`);
        throw new RegistryFetchError('unreachable', `${entry.title}: the catalog could not be reached`);
    }
    if (!response.ok) {
        throw new RegistryFetchError('status', `${entry.title}: the catalog returned ${response.status}`);
    }

    let text: string;
    try {
        text = await readBoundedText(response, options.maxBytes ?? MAX_SPEC_BYTES, signal);
    } catch (err) {
        if (err instanceof RegistryFetchError) throw err;
        if (isTimeout(err)) throw new RegistryFetchError('timeout', `${entry.title}: the spec did not finish downloading in time`);
        throw new RegistryFetchError('unreachable', `${entry.title}: the download failed`);
    }
    try {
        return JSON.parse(text);
    } catch {
        // Never echo the parse error: its message quotes the document.
        throw new RegistryFetchError('not_json', `${entry.title}: the spec is not valid JSON`);
    }
}

/** Load and validate the static index. `null` when it is missing or malformed. */
export async function loadApiIndex(fetchImpl: typeof fetch = globalThis.fetch, signal?: AbortSignal): Promise<ApiIndex | null> {
    try {
        const response = await fetchImpl(API_INDEX_PATH, { headers: { Accept: 'application/json' }, signal });
        if (!response.ok) return null;
        return parseApiIndex(await response.json());
    } catch {
        return null;
    }
}
