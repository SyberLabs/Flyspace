'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { isUsableEntry, MAX_INDEXED_OPERATIONS, type ApiIndex, type ApiIndexEntry } from '@/core/capabilities/apiIndex';
import { CURATED_APIS } from '@/core/capabilities/curatedApis';
import { createApiSearcher, loadApiIndex } from '@/core/capabilities/registrySearch';
import { fetchIntentScores, rankResults, routedIntents, unavailableIntents, type IntentScore } from '@/core/capabilities/registryRanking';

/** Results shown at once. A list longer than this is a scroll, not a choice. */
const SHOWN = 12;

/**
 * Whether search by meaning is on. Mirrors the server's
 * OMNI_REGISTRY_JEV_ENABLED so the box never offers a route the server will
 * refuse, and so the disclosure is shown before any text is sent.
 */
function meaningSearchEnabled(): boolean {
    return process.env.NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED === '1'
        && process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO !== '1';
}

function intentLabel(id: string): string {
    return id.replace(/_/g, ' ');
}

/** `2023-03` — enough to tell a fresh spec from a stale one at a glance. */
/** `12 operations`, or `100+ operations` at the compiler's cap. */
function operationCount(count: number): string {
    return `${count}${count >= MAX_INDEXED_OPERATIONS ? '+' : ''} operation${count === 1 ? '' : 's'}`;
}

function shortDate(updated: string): string {
    return updated ? updated.slice(0, 7) : 'date unknown';
}

export interface ApiSearchProps {
    /** The entry currently open in the review, if any. */
    selectedId?: string | null;
    /** A supported entry was chosen. The caller fetches and reviews it. */
    onSelect: (entry: ApiIndexEntry) => void;
    /** Focus the box on mount (the dialog opens straight into search). */
    autoFocus?: boolean;
}

/**
 * Find an API in the bundled directory. Keyword results appear as you type;
 * with search by meaning on, Enter also asks JEV which kind of API the text
 * is about. Choosing a result only selects it: fetching, review and install
 * belong to the caller.
 */
export function ApiSearch({ selectedId, onSelect, autoFocus }: ApiSearchProps) {
    const [index, setIndex] = useState<ApiIndex | null>(null);
    const [indexState, setIndexState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [query, setQuery] = useState('');
    const [routing, setRouting] = useState<{ query: string; scores: IntentScore[] } | null>(null);
    const [routingBusy, setRoutingBusy] = useState(false);
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

    // Curated APIs ship with OmniOS and are searched beside the directory.
    const entries = useMemo(() => (index ? [...CURATED_APIS.map(api => api.entry), ...index.entries] : []), [index]);
    const searcher = useMemo(() => (index ? createApiSearcher(entries) : null), [index, entries]);
    const byId = useMemo(() => new Map(entries.map(entry => [entry.id, entry])), [entries]);

    // Routing applies only to the query it was asked for. Typing on drops back
    // to keyword order until Enter asks again.
    const scores = routing && routing.query === query.trim() ? routing.scores : null;
    const results = useMemo(
        () => (searcher && query.trim() ? rankResults(query, searcher, byId, scores).slice(0, SHOWN) : []),
        [searcher, byId, query, scores]
    );
    const understoodAs = routedIntents(scores).map(score => intentLabel(score.id));
    const nothingYet = unavailableIntents(scores);

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

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <form
                role="search"
                className="shrink-0 space-y-1.5 border-b border-[var(--citadel-border)] p-3"
                onSubmit={event => {
                    event.preventDefault();
                    void askMeaning();
                }}
            >
                <input
                    type="search"
                    aria-label="Search APIs"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder={meaning ? 'Describe what you need, e.g. "is it going to rain tomorrow"' : 'Search 2,500 APIs: weather, SMS, currency…'}
                    maxLength={200}
                    autoComplete="off"
                    autoFocus={autoFocus}
                    disabled={indexState !== 'ready'}
                    className="w-full rounded-lg border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--citadel-primary)] focus:outline-none"
                />
                <p className="min-h-[1rem] text-[11px] leading-4 text-[var(--text-muted)]">
                    {routingBusy
                        ? 'Understanding your search…'
                        : understoodAs.length > 0
                            ? `Understood as: ${understoodAs.join(', ')}`
                            : meaning
                                ? 'Enter searches by meaning. Your search text, and only that, is sent to TypeSafe (JEV).'
                                : null}
                </p>
                {!routingBusy && nothingYet.length > 0 ? (
                    <p role="status" className="text-[11px] leading-4 text-[var(--truth-amber)] [overflow-wrap:anywhere]">
                        {nothingYet.map(({ id, reason }) => `No ${intentLabel(id)} API OmniOS can use yet. ${reason}`).join(' ')}
                    </p>
                ) : null}
            </form>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {indexState === 'loading' ? (
                    <p className="p-2 text-xs text-[var(--text-muted)]">Loading the API directory…</p>
                ) : indexState === 'failed' ? (
                    <p className="p-2 text-xs text-[var(--truth-red)]">
                        The API directory could not be loaded. Paste an OpenAPI document instead.
                    </p>
                ) : !query.trim() ? (
                    <p className="p-2 text-xs text-[var(--text-muted)]">
                        {index?.entries.length.toLocaleString()} APIs from the APIs.guru directory.
                    </p>
                ) : results.length === 0 ? (
                    <p className="p-2 text-xs text-[var(--text-muted)]">
                        No APIs match.{meaning && !scores ? ' Press Enter to search by meaning.' : ''}
                    </p>
                ) : (
                    <ul aria-label="API search results" className="space-y-1">
                        {results.map(({ entry, source, intent }) => {
                            const selected = entry.id === selectedId;
                            const usable = isUsableEntry(entry);
                            const label = !entry.supported
                                ? `${entry.title} (not supported)`
                                : usable ? `Review ${entry.title}` : `${entry.title} (nothing usable yet)`;
                            return (
                                <li key={entry.id}>
                                    <button
                                        type="button"
                                        aria-label={label}
                                        aria-pressed={selected}
                                        disabled={!usable}
                                        onClick={() => onSelect(entry)}
                                        className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${selected
                                            ? 'border-[var(--citadel-primary)] bg-[var(--citadel-elevated)]'
                                            : 'border-transparent hover:border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)]'
                                        } disabled:cursor-not-allowed disabled:opacity-50`}
                                    >
                                        <span className="block text-sm font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                                            {entry.title}
                                        </span>
                                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-muted)]">
                                            <span className="max-w-full truncate">{entry.id}</span>
                                            {entry.curated ? <span>· curated by OmniOS</span> : <span>· spec {shortDate(entry.updated)}</span>}
                                            {source === 'intent' && intent ? <span>· matches “{intentLabel(intent)}”</span> : null}
                                            {entry.supported ? null : <span>· Swagger {entry.openapiVersion}, not supported yet</span>}
                                            {entry.operations ? <span>· {operationCount(entry.operations)}</span> : null}
                                        </span>
                                        {entry.supported && entry.operations === 0 ? (
                                            <span className="mt-0.5 block text-[11px] text-[var(--truth-amber)] [overflow-wrap:anywhere]">
                                                Nothing usable yet{entry.blocker ? `: ${entry.blocker}` : ''}
                                            </span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {index ? (
                <p className="shrink-0 border-t border-[var(--citadel-border)] px-3 py-2 text-[10px] leading-4 text-[var(--text-muted)]">
                    APIs.guru directory (CC0){index.source.lastModified ? `, updated ${new Date(index.source.lastModified).toISOString().slice(0, 10)}` : ''}.
                    Specs can be out of date.
                </p>
            ) : null}
        </div>
    );
}
