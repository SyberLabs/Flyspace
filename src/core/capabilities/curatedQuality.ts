// What the quality line last found for each curated API (APEX_PLAN 6.4).
// public/curated-quality.json is written by `npm run verify:curated -- --write`
// and committed by a person; this reads it, so search can say "verified".

import report from '../../../public/curated-quality.json';

export type Verification =
    | { status: 'verified'; checkedAt: string }
    | { status: 'failing'; checkedAt: string; detail: string }
    | { status: 'unverified'; checkedAt?: string; reason: string };

interface ReportRow {
    api: string;
    status: string;
    detail: string;
}

function rows(value: { format?: unknown; results?: unknown }): ReportRow[] {
    if (value.format !== 'flyspace-curated-quality' || !Array.isArray(value.results)) return [];
    return value.results.filter((row): row is ReportRow =>
        typeof row === 'object' && row !== null
        && typeof (row as ReportRow).api === 'string'
        && typeof (row as ReportRow).status === 'string'
        && typeof (row as ReportRow).detail === 'string');
}

/** A curated API is verified when the run had at least one live answer and no failure. */
export function verificationFrom(value: unknown, apiId: string): Verification {
    const record = (typeof value === 'object' && value !== null ? value : {}) as { format?: unknown; results?: unknown; checkedAt?: unknown };
    const checkedAt = typeof record.checkedAt === 'string' ? record.checkedAt : undefined;
    const mine = rows(record).filter(row => row.api === apiId);
    if (!checkedAt || mine.length === 0) return { status: 'unverified', reason: 'not checked yet' };
    const failed = mine.find(row => row.status === 'failed');
    if (failed) return { status: 'failing', checkedAt, detail: failed.detail };
    if (mine.some(row => row.status === 'ok')) return { status: 'verified', checkedAt };
    return { status: 'unverified', checkedAt, reason: 'needs a key to check' };
}

/** What the committed report says about one curated API. */
export function verificationOf(apiId: string): Verification {
    return verificationFrom(report, apiId);
}
