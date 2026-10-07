'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiIndex, ApiIndexEntry } from '@/core/capabilities/apiIndex';
import { createApiSearcher, fetchCatalogSpec, loadApiIndex, RegistryFetchError } from '@/core/capabilities/registrySearch';
import { fetchIntentScores, rankResults, routedIntents, type IntentScore } from '@/core/capabilities/registryRanking';

/** Results shown at once. The ranking keeps more; a list this long is a scroll, not a choice. */
const SHOWN = 10;

/**
 * Whether search by meaning is on. Mirrors the server's
 * OMNI_REGISTRY_JEV_ENABLED, so the box never offers a route the server will
 * refuse, and so the disclosure is shown before any text is sent.
 */
function meaningSearchEnabled(): boolean {
    return process.env.NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED === '1'
        && process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO !== '1';
}

function intentLabel(id: string): string {
    return id.replace(/_/g, ' ');
}

function specDate(entry: ApiIndexEntry): string {
    return entry.updated ? `spec updated ${entry.updated}` : 'spec date unknown';
}

export interface ApiSearchProps {
    /** A spec was fetched for this entry. The caller compiles and reviews it. */
    onSpec: (document: unknown, entry: ApiIndexEntry) => void;
}

/**
 * Find an API in the bundled directory and fetch its spec, so nobody has to
 * go looking for the JSON. Keyword results appear as you type. With search
 * by meaning on, Enter also asks JEV which kind of API the text is about.
 * Choosing a result only fetches and compiles: what it does, where it sends
 * credentials and whether it needs approval are all shown before install.
 */
export function ApiSearch({ onSpec }: ApiSearchProps) {
    const [index, setIndex] = useState<ApiIndex | null>(null);
    const [indexState, setIndexState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [query, setQuery] = useState('');
    const [routing, setRouting] = useState<{ query: string; scores: IntentScore[] } | null>(null);
    const [routingBusy, setRoutingBusy] = useState(false);
    const [fetching, setFetching] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const routingAbort = useRef<AbortController | null>(null);
    const meaning = meaningSearchEnabled();

    useEffect(() => {
        const abort = new AbortController();
        loadApiIndex(globalThis.fetch, abort.signal).then(loaded => {
            if (abort.signal.aborted) return;
            setIndex(loaded);
            setIndexState(loaded ? 'ready' : 'failed');
        });
        return () => abort.abort();
    }, []);

    useEffect(() => () => routingAbort.current?.abort(), []);

    const searcher = useMemo(() => (index ? createApiSearcher(index.entries) : null), [index]);
    const byId = useMemo(() => new Map((index?.entries ?? []).map(entry => [entry.id, entry])), [index]);

    // Routing applies only to the query it was asked for. Typing on drops back
    // to keyword order until Enter asks again.
    const scores = routing && routing.query === query.trim() ? routing.scores : null;
    const results = useMemo(
        () => (searcher && query.trim() ? rankResults(query, searcher, byId, scores).slice(0, SHOWN) : []),
        [searcher, byId, query, scores]
    );
    const understoodAs = routedIntents(scores).map(score => intentLabel(score.id));

    const askMeaning = async () => {
        const text = query.trim();
        if (!meaning || !text) return;
        routingAbort.current?.abort();
        const abort = new AbortController();
        routingAbort.current = abort;
        setRoutingBusy(true);
        const answer = await fetchIntentScores(text, globalThis.fetch, abort.signal);
        if (abort.signal.aborted) return;
        setRoutingBusy(false);
        // A failed or disabled route leaves keyword results, which stand alone.
        setRouting(answer ? { query: text, scores: answer.scores } : null);
    };

    const choose = async (entry: ApiIndexEntry) => {
        setError(null);
        setFetching(entry.id);
        try {
            onSpec(await fetchCatalogSpec(entry), entry);
        } catch (err) {
            setError(err instanceof RegistryFetchError ? err.message : `${entry.title}: the spec could not be fetched`);
        } finally {
            setFetching(null);
        }
    };

    if (indexState === 'loading') {
        return <p className="text-xs text-[var(--text-muted)]">Loading the API directory…</p>;
    }
    if (indexState === 'failed' || !index) {
        return (
            <p className="text-xs text-[var(--truth-red)]">
                The API directory could not be loaded. Paste an OpenAPI document instead.
            </p>
        );
    }

    return (
        <div className="space-y-2">
            <form
                role="search"
                onSubmit={event => {
                    event.preventDefault();
                    void askMeaning();
                }}
            >
                <label className="block text-xs text-[var(--text-muted)]">
                    Search APIs
                    <input
                        type="search"
                        aria-label="Search APIs"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        placeholder="weather, send SMS, is it going to rain…"
                        maxLength={200}
                        autoComplete="off"
                        className="mt-1 w-full rounded border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] p-1 text-xs text-[var(--text-primary)]"
                    />
                </label>
            </form>
            {meaning ? (
                <p className="text-[10px] text-[var(--text-muted)]">
                    Press Enter to search by meaning. Your search text, and only that, is sent to TypeSafe (JEV).
                </p>
            ) : null}
            {routingBusy ? <p className="text-xs text-[var(--text-muted)]">Understanding your search…</p> : null}
            {understoodAs.length > 0 ? (
                <p className="text-xs text-[var(--text-muted)]">Understood as: {understoodAs.join(', ')}</p>
            ) : null}
            {error ? <p className="text-xs text-[var(--truth-red)]">{error}</p> : null}

            {query.trim() && results.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                    No APIs match.{meaning && !scores ? ' Press Enter to search by meaning.' : ''}
                </p>
            ) : null}

            {results.length > 0 ? (
                <ul aria-label="API search results" className="space-y-1">
                    {results.map(({ entry, source, intent }) => (
                        <li key={entry.id} className="rounded border border-[var(--citadel-border)] p-1.5 text-xs">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    {/* Directory titles include unbroken identifiers
                                        ("ApiManagementClient"); let them wrap rather
                                        than run under the button. */}
                                    <div className="font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">{entry.title}</div>
                                    <div className="truncate text-[10px] text-[var(--text-muted)]">
                                        {entry.id}
                                        {entry.categories.length > 0 ? ` · ${entry.categories.join(', ')}` : ''}
                                    </div>
                                    {/* The date is the staleness signal, so it gets a
                                        line of its own instead of being truncated away. */}
                                    <div className="text-[10px] text-[var(--text-muted)]">
                                        {specDate(entry)}
                                        {source === 'intent' && intent ? ` · matches “${intentLabel(intent)}”` : ''}
                                        {entry.supported ? '' : ` · Swagger ${entry.openapiVersion}, not supported yet`}
                                    </div>
                                </div>
                                {entry.supported ? (
                                    <button
                                        type="button"
                                        aria-label={`Use ${entry.title}`}
                                        disabled={fetching !== null}
                                        onClick={() => void choose(entry)}
                                        className="shrink-0 rounded border border-[var(--citadel-border)] px-2 py-0.5"
                                    >
                                        {fetching === entry.id ? 'Fetching…' : 'Use'}
                                    </button>
                                ) : null}
                            </div>
                        </li>
                    ))}
                </ul>
            ) : null}

            <p className="text-[10px] text-[var(--text-muted)]">
                From the APIs.guru directory (CC0){index.source.lastModified ? `, last updated ${new Date(index.source.lastModified).toISOString().slice(0, 10)}` : ''}.
                Specs can be out of date; check the review before installing.
            </p>
        </div>
    );
}
