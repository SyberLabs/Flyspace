// ============================================
// PROJECT OMNI: INFERENCE LEDGER
//
// Durable record of LLM executions, written at the one boundary where an
// execution actually happens: /api/llm. Nothing else in the app talks to a
// provider, so nothing else needs to write here.
//
// Two rules this module will not break:
//
//   1. A ledger failure never fails an inference. Every write is wrapped; a
//      dead database costs you a record, not an answer.
//   2. No credential reaches a row. Error and prompt text are scrubbed
//      against the server's own env values before being stored, because rows
//      are served back to the browser by /api/inference-runs.
//
// See INFERENCE_LEDGER.md.
// ============================================

import 'server-only';
import { query, transaction, isDatabaseConfigured } from '@/core/db/client';
import { SECRET_ENV_VARS, MIN_SECRET_LENGTH } from '@/core/secrets';

// ============================================
// TYPES
// ============================================

export type RunStatus = 'running' | 'succeeded' | 'failed' | 'canceled' | 'uncertain';
export type RunProvider = 'local' | 'anthropic' | 'google';
export type SourceKind = 'wire' | 'memory' | 'inference';

export interface RunSource {
    id: string;
    kind: SourceKind;
    label: string;
    /**
     * For a `kind: 'inference'` source — one persona feeding another — the run
     * whose ANSWER was consumed. This is the edge the lineage walk follows.
     * Absent when the upstream turn predates the ledger or was never recorded
     * (no database at the time, a failed open), which is why the column is
     * nullable rather than required on inference rows.
     */
    parentRunId?: string;
}

export interface OpenRunInput {
    provider: RunProvider;
    model: string;
    streamed: boolean;
    messageCount: number;
    promptChars: number;
    /** The final user turn. Truncated here, never stored whole. */
    prompt?: string;
    temperature?: number;
    maxTokens?: number;
    sources?: RunSource[];
}

export interface RunOutcome {
    output?: string;
    outputChars?: number;
    tokensUsed?: number;
    finishReason?: string;
}

/**
 * A run in flight. Always returned, even with no database and even when the
 * opening INSERT failed — then every method is a no-op, so the route reads
 * the same either way and carries no `if (ledgerEnabled)` branches.
 */
export interface LedgerRun {
    /** Row id, or null when nothing was recorded. */
    readonly id: string | null;
    succeeded(outcome: RunOutcome): Promise<void>;
    failed(error: unknown): Promise<void>;
    /** User halted the stream. The partial output is kept, as on the canvas. */
    canceled(outcome: RunOutcome): Promise<void>;
    uncertain(error: unknown): Promise<void>;
    /**
     * Pipe a provider stream through the ledger. Counts what was delivered
     * and closes the row on end, cancel or mid-stream error.
     */
    meter(stream: ReadableStream<Uint8Array>, onCancel?: (reason?: unknown) => void): ReadableStream<Uint8Array>;
}

/**
 * How much prompt/output text a row keeps. The columns are named `*_excerpt`
 * because that is what they hold — a truncated row must never be mistaken
 * for the whole exchange.
 */
export const EXCERPT_LIMIT = 4_000;

/** Per-run cap on recorded sources; more than this is a wiring accident. */
export const MAX_SOURCES = 64;

const POSTGRES_BIGINT_MAX = '9223372036854775807';

/** Normalize decimal IDs before they can reach a PostgreSQL bigint cast. */
export function normalizePostgresBigintId(value: string): string | undefined {
    if (!/^\d{1,19}$/.test(value)) return undefined;
    const normalized = value.replace(/^0+(?=\d)/, '');
    if (normalized.length > POSTGRES_BIGINT_MAX.length) return undefined;
    if (normalized.length === POSTGRES_BIGINT_MAX.length && normalized > POSTGRES_BIGINT_MAX) {
        return undefined;
    }
    return normalized;
}

const ERROR_LIMIT = 500;

// ============================================
// REDACTION
// ============================================

/**
 * Replace any live env secret found in `text` with a marker.
 *
 * The list is shared with the build-time bundle scanner (see core/secrets.ts)
 * so a newly added provider key cannot be covered by one and missed by the
 * other. An upstream error can carry the URL it was built from, and two of the
 * data providers put their key in a query string (see FINDINGS.md).
 */
export function scrubSecrets(text: string): string {
    let out = text;
    for (const name of SECRET_ENV_VARS) {
        const value = process.env[name];
        // A short value would match half the alphabet; a real key is long.
        if (!value || value.length < MIN_SECRET_LENGTH) continue;
        while (out.includes(value)) {
            out = out.replace(value, `[redacted:${name}]`);
        }
    }
    return out;
}

/** Bounded, scrubbed, single-line error text safe to store and serve back. */
export function normalizeError(error: unknown): string {
    const raw = error instanceof Error
        ? error.message
        : typeof error === 'string' ? error : 'Unknown error';
    const clean = scrubSecrets(raw).replace(/\s+/g, ' ').trim().slice(0, ERROR_LIMIT);
    return clean || 'Unknown error';
}

/** Keep the tail of a prompt: the task sits after the wired-data context. */
export function promptExcerpt(prompt?: string): string | null {
    if (prompt === undefined) return null;
    const scrubbed = scrubSecrets(prompt);
    return scrubbed.length <= EXCERPT_LIMIT
        ? scrubbed
        : `…${scrubbed.slice(-EXCERPT_LIMIT)}`;
}

/** Keep the head of an answer: that is where it says what it concluded. */
export function outputExcerpt(output?: string): string | null {
    if (output === undefined) return null;
    const scrubbed = scrubSecrets(output);
    return scrubbed.length <= EXCERPT_LIMIT
        ? scrubbed
        : `${scrubbed.slice(0, EXCERPT_LIMIT)}…`;
}

/** First source wins on a duplicate id; the composite PK rejects the second. */
function dedupeSources(sources: RunSource[]): RunSource[] {
    const seen = new Set<string>();
    const out: RunSource[] = [];
    for (const s of sources) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        out.push(s);
        if (out.length >= MAX_SOURCES) break;
    }
    return out;
}

// ============================================
// WRITE SIDE
// ============================================

const INSERT_RUN = `
    INSERT INTO inference_run (
        provider, model, streamed, status,
        message_count, prompt_chars, prompt_excerpt, temperature, max_tokens
    ) VALUES ($1, $2, $3, 'running', $4, $5, $6, $7, $8)
    RETURNING id
`;

const INSERT_SOURCE = `
    INSERT INTO inference_source (run_id, source_id, kind, label, parent_run_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (run_id, source_id) DO NOTHING
`;

/**
 * Closes a run. `status = 'running'` in the WHERE makes it idempotent: a
 * stream that both errored and was cancelled writes one terminal row.
 */
const FINISH_RUN = `
    UPDATE inference_run
       SET status = $2,
           finished_at = now(),
           latency_ms = $3,
           output_chars = $4,
           output_excerpt = $5,
           tokens_used = $6,
           finish_reason = $7,
           error = $8
     WHERE id = $1
       AND status = 'running'
`;

const NOOP_RUN: LedgerRun = {
    id: null,
    async succeeded() { /* nothing was opened */ },
    async failed() { /* nothing was opened */ },
    async canceled() { /* nothing was opened */ },
    async uncertain() { /* nothing was opened */ },
    meter: (stream) => stream
};

/**
 * How long the ledger stops trying after a failed open.
 *
 * The opening INSERT is on the request path, so a configured-but-unreachable
 * Postgres would otherwise add the connection timeout to EVERY inference —
 * a ledger that cannot record must not also be a ledger that taxes. One
 * request pays the timeout, the next half-minute of them pay nothing, and
 * recovery needs no restart.
 */
export const OPEN_FAILURE_COOLDOWN_MS = 30_000;

let suppressedUntil = 0;

/** Test seam: forget a tripped cooldown. */
export function resetLedgerCooldown(): void {
    suppressedUntil = 0;
}

/**
 * Open a run row and return a handle that closes it. The INSERT is awaited so
 * the row exists before the provider is called — a process that dies mid-call
 * then leaves a visible 'running' row instead of no trace at all.
 */
export async function openRun(input: OpenRunInput): Promise<LedgerRun> {
    if (!isDatabaseConfigured()) return NOOP_RUN;
    if (Date.now() < suppressedUntil) return NOOP_RUN;

    const startedAt = Date.now();
    let id: string | null = null;

    try {
        // The run and its sources land together or not at all: a run whose
        // provenance half failed would misreport what fed it.
        id = await transaction(async (client) => {
            const inserted = await client.query<{ id: string }>(INSERT_RUN, [
                input.provider,
                input.model,
                input.streamed,
                input.messageCount,
                input.promptChars,
                promptExcerpt(input.prompt),
                input.temperature ?? null,
                input.maxTokens ?? null
            ]);
            const runId = inserted.rows[0].id;

            for (const source of dedupeSources(input.sources ?? [])) {
                await client.query(INSERT_SOURCE, [
                    runId,
                    source.id,
                    source.kind,
                    source.label,
                    // The CHECK refuses a parent on a non-inference source, so
                    // the kind decides it here rather than trusting the caller.
                    source.kind === 'inference' ? source.parentRunId ?? null : null
                ]);
            }
            return runId;
        });
    } catch (err) {
        suppressedUntil = Date.now() + OPEN_FAILURE_COOLDOWN_MS;
        console.error(
            `[ledger] could not open run (pausing ${OPEN_FAILURE_COOLDOWN_MS}ms):`,
            normalizeError(err)
        );
        return NOOP_RUN;
    }

    if (!id) return NOOP_RUN;
    suppressedUntil = 0;
    return new OpenLedgerRun(id, startedAt);
}

class OpenLedgerRun implements LedgerRun {
    constructor(readonly id: string, private readonly startedAt: number) { }

    private async finish(
        status: Exclude<RunStatus, 'running'>,
        outcome: RunOutcome,
        error: string | null
    ): Promise<void> {
        const { output } = outcome;
        try {
            await query(FINISH_RUN, [
                this.id,
                status,
                Math.max(0, Date.now() - this.startedAt),
                outcome.outputChars ?? (output === undefined ? null : output.length),
                outputExcerpt(output),
                outcome.tokensUsed ?? null,
                outcome.finishReason ?? null,
                error
            ]);
        } catch (err) {
            // Rule 1: the answer already went out. Losing the row is the
            // cheaper failure, and the row stays 'running' to say so.
            console.error(`[ledger] could not close run ${this.id}:`, normalizeError(err));
        }
    }

    succeeded(outcome: RunOutcome): Promise<void> {
        return this.finish('succeeded', outcome, null);
    }

    failed(error: unknown): Promise<void> {
        return this.finish('failed', {}, normalizeError(error));
    }

    canceled(outcome: RunOutcome): Promise<void> {
        return this.finish('canceled', outcome, null);
    }

    uncertain(error: unknown): Promise<void> {
        return this.finish('uncertain', {}, normalizeError(error));
    }

    meter(stream: ReadableStream<Uint8Array>, onCancel?: (reason?: unknown) => void): ReadableStream<Uint8Array> {
        return meterStream(stream, this, onCancel);
    }
}

/** What `meterStream` needs of a run. Keeps it testable without a database. */
export type MeterableRun = Pick<LedgerRun, 'succeeded' | 'failed' | 'canceled'> &
    Partial<Pick<LedgerRun, 'uncertain'>>;

/**
 * Tee a text stream into the ledger without buffering it: chunks pass straight
 * through, only a running length and a bounded head are kept.
 *
 * A user pressing Stop cancels the response body, which lands here as
 * `cancel` — recorded as 'canceled', not 'failed', because the partial answer
 * was kept on the canvas and the run did what was asked of it.
 */
export function meterStream(
    stream: ReadableStream<Uint8Array>,
    run: MeterableRun,
    onCancel?: (reason?: unknown) => void
): ReadableStream<Uint8Array> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let chars = 0;
    let head = '';
    let closed = false;

    /** Whatever was delivered before this stream ended, however it ended. */
    const delivered = (finishReason: string): RunOutcome => ({
        output: head,
        outputChars: chars,
        finishReason
    });

    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    if (!closed) {
                        closed = true;
                        await run.succeeded(delivered('stop'));
                    }
                    controller.close();
                    return;
                }
                const text = decoder.decode(value, { stream: true });
                chars += text.length;
                if (head.length < EXCERPT_LIMIT) head += text;
                controller.enqueue(value);
            } catch (err) {
                if (!closed) {
                    closed = true;
                    // Once a provider stream has started, transport/body errors
                    // do not prove whether the provider completed the request.
                    await (run.uncertain?.(err) ?? run.failed(err));
                }
                controller.error(err);
            }
        },
        async cancel(reason) {
            if (!closed) {
                closed = true;
                onCancel?.(reason);
                await run.canceled(delivered('canceled'));
            }
            await reader.cancel(reason);
        }
    });
}

// ============================================
// READ SIDE
// ============================================

export interface LedgerRunRow {
    id: string;
    provider: RunProvider;
    model: string;
    streamed: boolean;
    status: RunStatus;
    startedAt: string;
    finishedAt: string | null;
    latencyMs: number | null;
    messageCount: number;
    promptChars: number;
    promptExcerpt: string | null;
    temperature: number | null;
    maxTokens: number | null;
    outputChars: number | null;
    outputExcerpt: string | null;
    tokensUsed: number | null;
    finishReason: string | null;
    error: string | null;
    sources: RunSource[];
}

export interface RecentRunsFilter {
    limit?: number;
    provider?: RunProvider;
    status?: RunStatus;
}

export const DEFAULT_RUN_LIMIT = 25;
export const MAX_RUN_LIMIT = 200;

interface RawRunRow {
    id: string;
    provider: RunProvider;
    model: string;
    streamed: boolean;
    status: RunStatus;
    started_at: Date | string;
    finished_at: Date | string | null;
    latency_ms: number | null;
    message_count: number;
    prompt_chars: number;
    prompt_excerpt: string | null;
    temperature: number | null;
    max_tokens: number | null;
    output_chars: number | null;
    output_excerpt: string | null;
    tokens_used: number | null;
    finish_reason: string | null;
    error: string | null;
}

interface RawSourceRow {
    run_id: string;
    source_id: string;
    kind: SourceKind;
    label: string;
    parent_run_id: string | null;
}

function toSource(row: RawSourceRow): RunSource {
    return {
        id: row.source_id,
        kind: row.kind,
        label: row.label,
        ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {})
    };
}

const RUN_COLUMNS = `
    id, provider, model, streamed, status, started_at, finished_at, latency_ms,
    message_count, prompt_chars, prompt_excerpt, temperature, max_tokens,
    output_chars, output_excerpt, tokens_used, finish_reason, error
`;

/**
 * The same columns, qualified. The lineage query joins the recursive CTE to
 * `inference_run`, and both carry `id` — an unqualified list is ambiguous.
 */
const RUN_COLUMNS_QUALIFIED = RUN_COLUMNS
    .split(',')
    .map(c => `inference_run.${c.trim()}`)
    .join(', ');

const SELECT_SOURCES = `
    SELECT run_id, source_id, kind, label, parent_run_id
      FROM inference_source
     WHERE run_id = ANY($1::bigint[])
     ORDER BY run_id, label
`;

function iso(value: Date | string | null): string | null {
    if (value === null) return null;
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Bucket source rows by the run that consumed them. */
function groupSources(rows: RawSourceRow[]): Map<string, RunSource[]> {
    const byRun = new Map<string, RunSource[]>();
    for (const row of rows) {
        const list = byRun.get(row.run_id) ?? [];
        list.push(toSource(row));
        byRun.set(row.run_id, list);
    }
    return byRun;
}

/** Clamp a caller-supplied limit into something a single page can hold. */
export function clampLimit(limit?: number): number {
    if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_RUN_LIMIT;
    return Math.min(MAX_RUN_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * The read this ledger exists for. Filters are appended as fixed SQL
 * fragments with bound placeholders — a value is never concatenated — which
 * keeps the predicate clean enough for the provider index to be used.
 *
 * Two statements rather than a JSON aggregate: the run page is bounded by
 * LIMIT, and its sources are then one indexed lookup by primary-key prefix.
 */
export async function recentRuns(filter: RecentRunsFilter = {}): Promise<LedgerRunRow[]> {
    if (!isDatabaseConfigured()) return [];

    const where: string[] = [];
    const values: unknown[] = [];

    if (filter.provider) {
        values.push(filter.provider);
        where.push(`provider = $${values.length}`);
    }
    if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
    }

    values.push(clampLimit(filter.limit));

    const sql = `
        SELECT ${RUN_COLUMNS}
          FROM inference_run
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY started_at DESC, id DESC
         LIMIT $${values.length}
    `;

    const runs = await query<RawRunRow>(sql, values);
    if (!runs || runs.rows.length === 0) return [];

    const sources = await query<RawSourceRow>(SELECT_SOURCES, [runs.rows.map(r => r.id)]);

    const byRun = groupSources(sources?.rows ?? []);

    return runs.rows.map(r => toRunRow(r, byRun.get(r.id) ?? []));
}

// ============================================
// LINEAGE — the recursive walk
//
// A cascade ("Analyst feeds Strategist") makes one run's answer the evidence
// for the next. `inference_source.parent_run_id` records that edge, so the
// ledger is a DAG and the real grounding of a final answer is several hops
// back — hops the canvas cannot show, because block data is live and the
// upstream evidence has been overwritten by the time you ask.
// ============================================

export interface LineageNode {
    run: LedgerRunRow;
    /** 0 for the run asked about; 1 for what fed it, and so on. */
    depth: number;
    /** The run this one fed. null for the root. */
    childRunId: string | null;
    /** The source label the child cited it under — the chip on the canvas. */
    viaLabel: string | null;
    /**
     * This node was already on the path from the root, so the walk stopped
     * here. Two personas wired to each other is a shape `planCascade`
     * already detects and breaks client-side; the ledger reports it.
     */
    isCycle: boolean;
}

export interface RunLineage {
    root: LedgerRunRow | null;
    nodes: LineageNode[];
    /** A cycle was found and not followed. */
    hadCycle: boolean;
    /** The walk hit `maxDepth` and there may be more above it. */
    truncated: boolean;
}

export const DEFAULT_LINEAGE_DEPTH = 10;
export const MAX_LINEAGE_DEPTH = 25;
/** Hard stop on a pathological fan-out, independent of depth. */
export const MAX_LINEAGE_NODES = 500;

/**
 * Walk from a run up through the answers that fed it.
 *
 * Cycle handling is an explicit `path` array rather than the SQL-standard
 * `CYCLE ... SET ... USING` clause, which needs Postgres 14. The array costs
 * two extra expressions and keeps the documented Postgres 12 floor — a
 * version bump is a poor price for syntax sugar. A repeated run is emitted
 * once, marked `is_cycle`, and not expanded, which is exactly what the CYCLE
 * clause would do.
 *
 * `depth < $2` bounds the recursion independently, so a malformed graph
 * cannot run away even if the path logic were wrong.
 */
const SELECT_LINEAGE = `
    WITH RECURSIVE lineage AS (
        SELECT
            r.id,
            0                AS depth,
            ARRAY[r.id]      AS path,
            false            AS is_cycle,
            NULL::bigint     AS child_run_id,
            NULL::text       AS via_label
          FROM inference_run r
         WHERE r.id = $1

        UNION ALL

        SELECT
            parent.id,
            l.depth + 1,
            l.path || parent.id,
            parent.id = ANY(l.path),
            l.id,
            s.label
          FROM lineage l
          JOIN inference_source s
            ON s.run_id = l.id
           AND s.parent_run_id IS NOT NULL
          JOIN inference_run parent
            ON parent.id = s.parent_run_id
         WHERE l.depth < $2
           AND NOT l.is_cycle
    )
    SELECT
        l.depth, l.is_cycle, l.child_run_id, l.via_label,
        ${RUN_COLUMNS_QUALIFIED}
      FROM lineage l
      JOIN inference_run ON inference_run.id = l.id
     ORDER BY l.depth, l.id
     LIMIT $3
`;

interface RawLineageRow extends RawRunRow {
    depth: number;
    is_cycle: boolean;
    child_run_id: string | null;
    via_label: string | null;
}

function toRunRow(r: RawRunRow, sources: RunSource[]): LedgerRunRow {
    return {
        id: r.id,
        provider: r.provider,
        model: r.model,
        streamed: r.streamed,
        status: r.status,
        startedAt: iso(r.started_at)!,
        finishedAt: iso(r.finished_at),
        latencyMs: r.latency_ms,
        messageCount: r.message_count,
        promptChars: r.prompt_chars,
        promptExcerpt: r.prompt_excerpt,
        temperature: r.temperature,
        maxTokens: r.max_tokens,
        outputChars: r.output_chars,
        outputExcerpt: r.output_excerpt,
        tokensUsed: r.tokens_used,
        finishReason: r.finish_reason,
        error: r.error,
        sources
    };
}

/** Clamp a caller-supplied depth to something one query can answer. */
export function clampDepth(depth?: number): number {
    if (depth === undefined || !Number.isFinite(depth)) return DEFAULT_LINEAGE_DEPTH;
    return Math.min(MAX_LINEAGE_DEPTH, Math.max(0, Math.floor(depth)));
}

/**
 * Everything that made this answer: the run, the runs that fed it, and the
 * raw sources at every level.
 *
 * Two statements, as with `recentRuns`: the recursive walk bounds the set of
 * runs, then one indexed lookup attaches every level's sources. Doing it in
 * one query would mean aggregating inside the recursion, which is both
 * slower and harder to read than a second primary-key-prefix scan.
 */
export async function runLineage(
    runId: string,
    maxDepth?: number
): Promise<RunLineage> {
    const empty: RunLineage = { root: null, nodes: [], hadCycle: false, truncated: false };
    if (!isDatabaseConfigured()) return empty;

    const depth = clampDepth(maxDepth);
    const result = await query<RawLineageRow>(SELECT_LINEAGE, [runId, depth, MAX_LINEAGE_NODES]);
    if (!result || result.rows.length === 0) return empty;

    const sources = await query<RawSourceRow>(SELECT_SOURCES, [result.rows.map(r => r.id)]);
    const byRun = groupSources(sources?.rows ?? []);

    const nodes: LineageNode[] = result.rows.map(r => ({
        run: toRunRow(r, byRun.get(r.id) ?? []),
        depth: r.depth,
        childRunId: r.child_run_id,
        viaLabel: r.via_label,
        isCycle: r.is_cycle
    }));

    return {
        root: nodes.find(n => n.depth === 0)?.run ?? null,
        nodes,
        hadCycle: nodes.some(n => n.isCycle),
        // A node at the depth limit that still has an unfollowed parent edge
        // is the only honest signal that there was more above it.
        truncated:
            nodes.length >= MAX_LINEAGE_NODES ||
            nodes.some(n => n.depth === depth && !n.isCycle && hasParentEdge(n, byRun))
    };
}

/** Whether this node cited another run that the depth limit stopped us following. */
function hasParentEdge(node: LineageNode, byRun: Map<string, RunSource[]>): boolean {
    return (byRun.get(node.run.id) ?? []).some(s => s.parentRunId);
}
