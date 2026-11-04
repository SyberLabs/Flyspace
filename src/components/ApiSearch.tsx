'use client';

import { useEffect, useMemo, useState } from 'react';
import { isUsableEntry, MAX_INDEXED_OPERATIONS, type ApiIndex, type ApiIndexEntry } from '@/core/capabilities/apiIndex';
import { CURATED_APIS } from '@/core/capabilities/curatedApis';
import { verificationOf, type Verification } from '@/core/capabilities/curatedQuality';
import { createApiSearcher, DEFAULT_RESULT_LIMIT, loadApiIndex } from '@/core/capabilities/registrySearch';

/** Results shown at once. A list longer than this is a scroll, not a choice. */
const SHOWN = 12;

/** `2023-03` — enough to tell a fresh spec from a stale one at a glance. */
/** What the quality line last found, in a few words. */
function verificationLabel(verification: Verification): string {
    if (verification.status === 'verified') return `verified ${verification.checkedAt.slice(0, 10)}`;
    if (verification.status === 'failing') return `failing since ${verification.checkedAt.slice(0, 10)}`;
    return `not verified (${verification.reason})`;
}

/** What a result needs to run, in a few words. */
const CREDENTIAL_LABEL = { none: 'no key', partial: 'some need a key', key: 'needs a key' } as const;

/** `12 operations`, or `100+ operations` at the compiler's cap. */
function operationCount(count: number): string {
    return `${count}${count >= MAX_INDEXED_OPERATIONS ? '+' : ''} operation${count === 1 ? '' : 's'}`;
}

function shortDate(updated: string): string {
    return updated ? updated.slice(0, 7) : 'date unknown';
}

interface ApiSearchProps {
    /** The entry currently open in the review, if any. */
    selectedId?: string | null;
    /** A supported entry was chosen. The caller fetches and reviews it. */
    onSelect: (entry: ApiIndexEntry) => void;
    /** Focus the box on mount (the dialog opens straight into search). */
    autoFocus?: boolean;
}

/**
 * Find an API in the bundled directory. Results appear as you type. Choosing
 * a result only selects it: fetching, review and install belong to the caller.
 */
export function ApiSearch({ selectedId, onSelect, autoFocus }: ApiSearchProps) {
    const [index, setIndex] = useState<ApiIndex | null>(null);
    const [indexState, setIndexState] = useState<'loading' | 'ready' | 'failed'>('loading');
    const [query, setQuery] = useState('');

    useEffect(() => {
        const abort = new AbortController();
        loadApiIndex(globalThis.fetch, abort.signal).then(loaded => {
            if (abort.signal.aborted) return;
            setIndex(loaded);
            setIndexState(loaded ? 'ready' : 'failed');
        });
        return () => abort.abort();
    }, []);

    // Curated APIs ship with Flyspace and are searched beside the directory.
    const entries = useMemo(() => (index ? [...CURATED_APIS.map(api => api.entry), ...index.entries] : []), [index]);
    const searcher = useMemo(() => (index ? createApiSearcher(entries) : null), [index, entries]);

    const [keylessOnly, setKeylessOnly] = useState(false);
    const results = useMemo(() => {
        if (!searcher || !query.trim()) return [];
        // Rank a wider pool when filtering, so the filter does not empty the list.
        const seen = new Set<string>();
        const ranked = searcher.search(query, keylessOnly ? SHOWN * 6 : DEFAULT_RESULT_LIMIT)
            .map(hit => hit.entry)
            .filter(entry => !seen.has(entry.id) && seen.add(entry.id));
        return (keylessOnly ? ranked.filter(entry => entry.credential === 'none') : ranked).slice(0, SHOWN);
    }, [searcher, query, keylessOnly]);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <form
                role="search"
                className="shrink-0 space-y-1.5 border-b border-[var(--citadel-border)] p-3"
                onSubmit={event => event.preventDefault()}
            >
                <input
                    type="search"
                    aria-label="Search APIs"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search 2,500 APIs: weather, SMS, currency…"
                    maxLength={200}
                    autoComplete="off"
                    autoFocus={autoFocus}
                    disabled={indexState !== 'ready'}
                    className="w-full rounded-lg border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--citadel-primary)] focus:outline-none"
                />
                <button
                    type="button"
                    aria-pressed={keylessOnly}
                    onClick={() => setKeylessOnly(on => !on)}
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${keylessOnly
                        ? 'border-[var(--citadel-primary)] text-[var(--text-primary)]'
                        : 'border-[var(--citadel-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
                >
                    No key needed
                </button>
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
                        No APIs match.
                    </p>
                ) : (
                    <ul aria-label="API search results" className="space-y-1">
                        {results.map(entry => {
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
                                            {entry.curated ? <span>· curated by Flyspace</span> : <span>· spec {shortDate(entry.updated)}</span>}
                                            {entry.curated ? <span>· {verificationLabel(verificationOf(entry.id))}</span> : null}
                                            {entry.supported ? null : <span>· Swagger {entry.openapiVersion}, not supported yet</span>}
                                            {entry.operations ? <span>· {operationCount(entry.operations)}</span> : null}
                                            {entry.credential ? <span>· {CREDENTIAL_LABEL[entry.credential]}</span> : null}
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
