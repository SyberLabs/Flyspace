'use client';

import { useState } from 'react';

/** How many rows of a list, or fields of a record, show before "show all". */
const PREVIEW_ROWS = 8;
/** A raw response bigger than this is cut in the raw view. */
const RAW_LIMIT = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `temp_f` → `Temp f`, `windSpeed` → `Wind speed`. */
function labelOf(key: string): string {
    const spaced = key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** A one-line rendering of any value, for a table cell. */
function cellOf(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
    return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`;
}

/** The field that best names a record in a list. */
function titleOf(record: Record<string, unknown>, index: number): string {
    for (const key of ['title', 'name', 'label', 'headline', 'summary', 'description', 'id']) {
        const value = record[key];
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number') return `${key} ${value}`;
    }
    return `Item ${index + 1}`;
}

function Fields({ record }: { record: Record<string, unknown> }) {
    const [all, setAll] = useState(false);
    const entries = Object.entries(record);
    const shown = all ? entries : entries.slice(0, PREVIEW_ROWS);
    return (
        <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2 gap-y-0.5 text-xs">
            {shown.map(([key, value]) => (
                <div key={key} className="contents">
                    <dt className="truncate text-[var(--text-muted)]" title={key}>{labelOf(key)}</dt>
                    <dd className="text-[var(--text-primary)] [overflow-wrap:anywhere]">
                        {isRecord(value) || Array.isArray(value) ? (
                            <details>
                                <summary className="cursor-pointer text-[var(--text-secondary)]">{cellOf(value)}</summary>
                                <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-[var(--text-muted)]">
                                    {JSON.stringify(value, null, 2).slice(0, 4000)}
                                </pre>
                            </details>
                        ) : cellOf(value)}
                    </dd>
                </div>
            ))}
            {entries.length > PREVIEW_ROWS ? (
                <button type="button" onClick={() => setAll(v => !v)}
                    className="col-span-2 justify-self-start text-[11px] text-[var(--text-secondary)] underline">
                    {all ? 'Show fewer' : `Show all ${entries.length} fields`}
                </button>
            ) : null}
        </dl>
    );
}

function List({ list }: { list: unknown[] }) {
    const [all, setAll] = useState(false);
    const shown = all ? list : list.slice(0, PREVIEW_ROWS);
    return (
        <div className="space-y-1">
            <p className="text-[11px] text-[var(--text-muted)]">{list.length} result{list.length === 1 ? '' : 's'}</p>
            <ul className="space-y-1">
                {shown.map((item, index) => (
                    <li key={index} className="rounded-md border border-[var(--citadel-border)] px-2 py-1 text-xs">
                        {isRecord(item) ? (
                            <details>
                                <summary className="cursor-pointer text-[var(--text-primary)] [overflow-wrap:anywhere]">{titleOf(item, index)}</summary>
                                <div className="mt-1"><Fields record={item} /></div>
                            </details>
                        ) : (
                            <span className="text-[var(--text-primary)] [overflow-wrap:anywhere]">{cellOf(item)}</span>
                        )}
                    </li>
                ))}
            </ul>
            {list.length > PREVIEW_ROWS ? (
                <button type="button" onClick={() => setAll(v => !v)} className="text-[11px] text-[var(--text-secondary)] underline">
                    {all ? 'Show fewer' : `Show all ${list.length}`}
                </button>
            ) : null}
        </div>
    );
}

/**
 * The response, laid out for reading: a record as label–value rows, a list
 * as rows you can open, text as text. "Raw JSON" shows exactly what came back.
 */
export function CapabilityResult({ value }: { value: unknown }) {
    const [raw, setRaw] = useState(false);
    if (value === undefined) return null;

    // A response that wraps its list in one field ({ results: [...] }) reads as the list.
    const keys = isRecord(value) ? Object.keys(value) : [];
    const unwrapped = keys.length === 1 && Array.isArray((value as Record<string, unknown>)[keys[0]])
        ? (value as Record<string, unknown[]>)[keys[0]]
        : value;

    return (
        <div className="space-y-1.5">
            <div className="flex justify-end">
                <button type="button" onClick={() => setRaw(v => !v)} aria-pressed={raw}
                    className="text-[10px] text-[var(--text-muted)] underline hover:text-[var(--text-primary)]">
                    {raw ? 'Formatted' : 'Raw JSON'}
                </button>
            </div>
            {raw ? (
                <pre data-testid="capability-raw" className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--citadel-elevated)] p-2 font-mono text-[10px] text-[var(--text-secondary)]">
                    {JSON.stringify(value, null, 2).slice(0, RAW_LIMIT)}
                </pre>
            ) : Array.isArray(unwrapped) ? (
                <List list={unwrapped} />
            ) : isRecord(unwrapped) ? (
                <Fields record={unwrapped} />
            ) : (
                <p className="whitespace-pre-wrap text-xs text-[var(--text-primary)] [overflow-wrap:anywhere]">{cellOf(unwrapped)}</p>
            )}
        </div>
    );
}
