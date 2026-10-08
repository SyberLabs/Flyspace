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

/** A list a table can show: records of a few mostly plain values. More columns read better as rows. */
const MAX_TABLE_COLUMNS = 6;

function isPlain(value: unknown): boolean {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** Says nothing: BLS sends `footnotes: [{}]` on every row. */
function isEmptyish(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    if (Array.isArray(value)) return value.every(item => isRecord(item) && Object.keys(item).length === 0);
    return isRecord(value) && Object.keys(value).length === 0;
}

export function tableOf(list: unknown[]): { columns: string[]; fixed: [string, unknown][] } | null {
    if (list.length === 0 || !list.every(isRecord)) return null;
    const records = list as Record<string, unknown>[];
    const keys: string[] = [];
    for (const record of records) for (const key of Object.keys(record)) if (!keys.includes(key)) keys.push(key);
    // A column empty in every row is left out; one holding nested values stays, summarised.
    const shown = keys.filter(key => !records.every(record => isEmptyish(record[key])));
    const plain = shown.filter(key => records.every(record => isPlain(record[key]) || isEmptyish(record[key])));
    if (plain.length === 0 || plain.length * 2 < shown.length) return null;
    // A plain column that holds one value in every row says it once, above the table.
    const fixed = records.length > 1
        ? plain.filter(key => records.every(record => record[key] === records[0][key])).map(key => [key, records[0][key]] as [string, unknown])
        : [];
    const columns = shown.filter(key => !fixed.some(([name]) => name === key));
    if (columns.length === 0 || columns.length > MAX_TABLE_COLUMNS) return null;
    return { columns, fixed };
}

function Table({ list, columns, fixed }: { list: Record<string, unknown>[]; columns: string[]; fixed: [string, unknown][] }) {
    const [all, setAll] = useState(false);
    const shown = all ? list : list.slice(0, PREVIEW_ROWS);
    return (
        <div className="space-y-1">
            <p className="text-[11px] text-[var(--text-muted)] [overflow-wrap:anywhere]">
                {list.length} result{list.length === 1 ? '' : 's'}
                {fixed.map(([key, value]) => <span key={key}> · {labelOf(key)} {cellOf(value)}</span>)}
            </p>
            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                    <thead>
                        <tr>
                            {columns.map(column => (
                                <th key={column} scope="col" className="border-b border-[var(--citadel-border)] px-1 py-0.5 text-left font-normal text-[var(--text-muted)]">
                                    {labelOf(column)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map((record, index) => (
                            <tr key={index}>
                                {columns.map(column => (
                                    <td key={column} className={`border-b border-[var(--citadel-border)]/50 px-1 py-0.5 text-[var(--text-primary)] ${cellOf(record[column]).length <= 12 ? 'whitespace-nowrap' : '[overflow-wrap:anywhere]'}`}>
                                        {cellOf(record[column])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {list.length > PREVIEW_ROWS ? (
                <button type="button" onClick={() => setAll(v => !v)} className="text-[11px] text-[var(--text-secondary)] underline">
                    {all ? 'Show fewer' : `Show all ${list.length}`}
                </button>
            ) : null}
        </div>
    );
}

function List({ list }: { list: unknown[] }) {
    const table = tableOf(list);
    const [all, setAll] = useState(false);
    const shown = all ? list : list.slice(0, PREVIEW_ROWS);
    if (table) return <Table list={list as Record<string, unknown>[]} columns={table.columns} fixed={table.fixed} />;
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

/** How deep to look for the list a response carries (BLS: Results.series[0].data). */
const MAX_LIST_DEPTH = 4;
const DATE_KEY = /^\d{4}-\d{2}(-\d{2})?([ T][\d:]+)?$/;

function isFlatRecord(value: unknown): value is Record<string, unknown> {
    return isRecord(value) && Object.values(value).every(isPlain);
}

/**
 * A map of same-shaped records, read as rows: Alpha Vantage's
 * `{ "2026-10-07": { "1. open": ... }, ... }`. The key becomes a column,
 * named `date` when every key is a date.
 */
function rowsOf(value: unknown): unknown[] | null {
    if (Array.isArray(value)) return value.length > 0 ? value : null;
    if (!isRecord(value)) return null;
    const entries = Object.entries(value);
    if (entries.length < 2 || !entries.every(([, entry]) => isFlatRecord(entry))) return null;
    const column = entries.every(([key]) => DATE_KEY.test(key)) ? 'date' : 'key';
    return entries.map(([key, entry]) => ({ [column]: key, ...(entry as Record<string, unknown>) }));
}

/**
 * The one list a response carries, found through wrappers: a record holding
 * exactly one list (FRED's `observations`, a search's `results`), a
 * one-element array around a record (BLS's `series`), or a map of rows.
 * Plain values and flat records beside it are kept as details.
 */
export function listInside(value: unknown, depth = 0): { key: string; list: unknown[]; rest: Record<string, unknown> } | null {
    if (depth > MAX_LIST_DEPTH) return null;
    if (Array.isArray(value)) {
        return value.length === 1 && isRecord(value[0]) ? listInside(value[0], depth + 1) : null;
    }
    if (!isRecord(value)) return null;
    const found = Object.entries(value).flatMap(([key, entry]) => {
        const rows = rowsOf(entry);
        if (rows && !(Array.isArray(entry) && entry.length === 1 && isRecord(entry[0]) && listInside(entry[0], depth + 1))) {
            return [{ key, list: rows, rest: {} as Record<string, unknown> }];
        }
        const inner = listInside(entry, depth + 1);
        return inner ? [inner] : [];
    });
    if (found.length !== 1) return null;
    const [inner] = found;
    const rest: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (key === inner.key || rowsOf(entry) || listInside(entry, depth + 1)) continue;
        if (isPlain(entry) || isFlatRecord(entry) || (Array.isArray(entry) && entry.length === 0)) rest[key] = entry;
        else return null; // something else nested beside it: not one answer
    }
    return { key: inner.key, list: inner.list, rest: { ...rest, ...inner.rest } };
}

/** `{ "Global Quote": { ... } }`: one record in a one-key wrapper reads as its fields. */
function unwrapRecord(value: unknown): { label: string; record: Record<string, unknown> } | null {
    if (!isRecord(value)) return null;
    const keys = Object.keys(value);
    return keys.length === 1 && isRecord(value[keys[0]]) ? { label: keys[0], record: value[keys[0]] as Record<string, unknown> } : null;
}

/**
 * The response, laid out for reading: a record as label–value rows, a list
 * as rows you can open, text as text. "Raw JSON" shows exactly what came back.
 */
export function CapabilityResult({ value }: { value: unknown }) {
    const [raw, setRaw] = useState(false);
    if (value === undefined) return null;

    // A response that wraps its one list ({ count, results: [...] }) reads as
    // the list; anything around it folds under "About this response".
    const wrapped = listInside(value);
    const single = wrapped ? null : unwrapRecord(value);
    const unwrapped = wrapped ? wrapped.list : single ? single.record : value;

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
                <>
                    <List list={unwrapped} />
                    {wrapped && Object.keys(wrapped.rest).length > 0 ? (
                        <details className="text-xs">
                            <summary className="cursor-pointer text-[11px] text-[var(--text-muted)]">
                                About this response · {Object.keys(wrapped.rest).length} field{Object.keys(wrapped.rest).length === 1 ? '' : 's'}
                            </summary>
                            <div className="mt-1"><Fields record={wrapped.rest} /></div>
                        </details>
                    ) : null}
                </>
            ) : isRecord(unwrapped) ? (
                <>
                    {single ? <p className="text-[11px] text-[var(--text-muted)]">{labelOf(single.label)}</p> : null}
                    <Fields record={unwrapped} />
                </>
            ) : (
                <p className="whitespace-pre-wrap text-xs text-[var(--text-primary)] [overflow-wrap:anywhere]">{cellOf(unwrapped)}</p>
            )}
        </div>
    );
}
