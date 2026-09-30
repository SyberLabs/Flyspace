// ============================================
// INFERENCE LEDGER — the two rules, locked.
//
//   1. A ledger failure never fails an inference. No path here may throw,
//      and the stream must deliver every byte regardless of the database.
//   2. No credential reaches a row, and no value reaches SQL except as a
//      bound parameter.
//
// The database is mocked: these run in CI with no Postgres. A real-schema
// test lives in inference.ledger.integration.test.ts and skips without
// DATABASE_URL.
// ============================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { query, transaction, isDatabaseConfigured } from '@/core/db/client';
import {
    openRun,
    resetLedgerCooldown,
    OPEN_FAILURE_COOLDOWN_MS,
    meterStream,
    recentRuns,
    scrubSecrets,
    normalizeError,
    promptExcerpt,
    outputExcerpt,
    clampLimit,
    normalizePostgresBigintId,
    clampDepth,
    runLineage,
    DEFAULT_LINEAGE_DEPTH,
    MAX_LINEAGE_DEPTH,
    MAX_LINEAGE_NODES,
    EXCERPT_LIMIT,
    MAX_SOURCES,
    DEFAULT_RUN_LIMIT,
    MAX_RUN_LIMIT,
    type MeterableRun,
    type RunSource
} from './inference.ledger';

vi.mock('@/core/db/client', () => ({
    query: vi.fn(),
    transaction: vi.fn(),
    isDatabaseConfigured: vi.fn(() => true)
}));

/** A recorded statement: text plus the values the driver would bind. */
interface Stmt {
    text: string;
    values: unknown[];
}

let inTransaction: Stmt[] = [];

/** Stand in for a pooled client, recording what the transaction body runs. */
function fakeTransaction(insertedId = '17') {
    vi.mocked(transaction).mockImplementation(async (fn) => {
        const client = {
            query: vi.fn(async (text: string, values?: unknown[]) => {
                inTransaction.push({ text, values: values ?? [] });
                return { rows: text.includes('RETURNING id') ? [{ id: insertedId }] : [] };
            })
        };
        return fn(client as never);
    });
}

const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'DATABASE_URL'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
    inTransaction = [];
    resetLedgerCooldown();
    vi.mocked(isDatabaseConfigured).mockReturnValue(true);
    vi.mocked(query).mockReset().mockResolvedValue({ rows: [] });
    vi.mocked(transaction).mockReset();
    fakeTransaction();
    for (const k of ENV_KEYS) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

const BASE_RUN = {
    provider: 'anthropic' as const,
    model: 'claude-opus-5',
    streamed: false,
    messageCount: 3,
    promptChars: 1234
};

/** Read one recorded statement by a fragment of its text. */
function stmt(statements: Stmt[], fragment: string): Stmt {
    const found = statements.find(s => s.text.includes(fragment));
    if (!found) throw new Error(`no statement containing ${fragment}`);
    return found;
}

function finishCalls(): Stmt[] {
    return vi.mocked(query).mock.calls
        .map(([text, values]) => ({ text, values: (values ?? []) as unknown[] }))
        .filter(s => s.text.includes('UPDATE inference_run'));
}

// ============================================
// RULE 1 — POSTGRES IS OPTIONAL
// ============================================

describe('without a database', () => {
    beforeEach(() => vi.mocked(isDatabaseConfigured).mockReturnValue(false));

    it('opens a run without touching the database', async () => {
        const run = await openRun(BASE_RUN);
        expect(run.id).toBeNull();
        expect(transaction).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
    });

    it('accepts every outcome as a silent no-op', async () => {
        const run = await openRun(BASE_RUN);
        await expect(run.succeeded({ output: 'hi' })).resolves.toBeUndefined();
        await expect(run.failed(new Error('boom'))).resolves.toBeUndefined();
        await expect(run.canceled({ output: 'partial' })).resolves.toBeUndefined();
        expect(query).not.toHaveBeenCalled();
    });

    it('returns the provider stream untouched, not a wrapper', async () => {
        const run = await openRun({ ...BASE_RUN, streamed: true });
        const source = new ReadableStream<Uint8Array>();
        expect(run.meter(source)).toBe(source);
    });

    it('reads back an empty list rather than querying', async () => {
        await expect(recentRuns()).resolves.toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });
});

describe('when the database is broken', () => {
    it('an insert failure degrades to a no-op handle instead of throwing', async () => {
        vi.mocked(transaction).mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
        const run = await openRun(BASE_RUN);
        expect(run.id).toBeNull();
        await expect(run.succeeded({ output: 'answer' })).resolves.toBeUndefined();
    });

    it('a close failure is swallowed — the answer already shipped', async () => {
        const run = await openRun(BASE_RUN);
        vi.mocked(query).mockRejectedValue(new Error('connection terminated'));
        await expect(run.succeeded({ output: 'answer' })).resolves.toBeUndefined();
    });

    it('a stream still delivers every byte when the ledger write fails', async () => {
        const run = await openRun({ ...BASE_RUN, streamed: true });
        vi.mocked(query).mockRejectedValue(new Error('connection terminated'));
        const metered = run.meter(streamOf('alpha', 'beta'));
        await expect(readAll(metered)).resolves.toBe('alphabeta');
    });

    // An unreachable-but-configured Postgres is the common case for an
    // optional dependency. Paying its connection timeout on every inference
    // would turn a missing record into a slow product.
    it('stops trying for a cooldown after a failed open', async () => {
        vi.mocked(transaction).mockRejectedValue(new Error('ECONNREFUSED'));
        await openRun(BASE_RUN);
        expect(transaction).toHaveBeenCalledTimes(1);

        await openRun(BASE_RUN);
        await openRun(BASE_RUN);
        expect(transaction).toHaveBeenCalledTimes(1);
    });

    it('tries again once the cooldown has passed', async () => {
        vi.mocked(transaction).mockRejectedValue(new Error('ECONNREFUSED'));
        await openRun(BASE_RUN);

        vi.useFakeTimers();
        try {
            vi.advanceTimersByTime(OPEN_FAILURE_COOLDOWN_MS + 1);
            fakeTransaction('42');
            const run = await openRun(BASE_RUN);
            expect(run.id).toBe('42');
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not suppress after a healthy open', async () => {
        await openRun(BASE_RUN);
        const second = await openRun(BASE_RUN);
        expect(second.id).toBe('17');
        expect(transaction).toHaveBeenCalledTimes(2);
    });
});

// ============================================
// OPENING A RUN
// ============================================

describe('openRun', () => {
    it('writes a running row and returns its id', async () => {
        const run = await openRun(BASE_RUN);
        expect(run.id).toBe('17');

        const insert = stmt(inTransaction, 'INSERT INTO inference_run');
        expect(insert.text).toContain("'running'");
        expect(insert.values).toEqual([
            'anthropic', 'claude-opus-5', false, 3, 1234, null, null, null
        ]);
    });

    it('binds every caller value as a parameter, never into the SQL', async () => {
        await openRun({
            ...BASE_RUN,
            model: "gpt'; DROP TABLE inference_run; --",
            prompt: 'what is the market saying?',
            temperature: 0.4,
            maxTokens: 2048
        });
        const insert = stmt(inTransaction, 'INSERT INTO inference_run');
        expect(insert.text).not.toContain('DROP TABLE');
        expect(insert.values).toContain("gpt'; DROP TABLE inference_run; --");
        expect(insert.values).toContain('what is the market saying?');
        expect(insert.values).toContain(0.4);
        expect(insert.values).toContain(2048);
    });

    it('records the run and its sources in one transaction', async () => {
        const sources: RunSource[] = [
            { id: 'block-1', kind: 'wire', label: 'Polymarket' },
            { id: 'pool-a', kind: 'memory', label: 'Working memory' }
        ];
        await openRun({ ...BASE_RUN, sources });

        expect(transaction).toHaveBeenCalledTimes(1);
        const sourceStmts = inTransaction.filter(s => s.text.includes('INSERT INTO inference_source'));
        expect(sourceStmts).toHaveLength(2);
        // Trailing null is parent_run_id: neither of these is a run.
        expect(sourceStmts[0].values).toEqual(['17', 'block-1', 'wire', 'Polymarket', null]);
        expect(sourceStmts[1].values).toEqual(['17', 'pool-a', 'memory', 'Working memory', null]);
    });

    it('drops a repeated source id — the composite key would reject it', async () => {
        await openRun({
            ...BASE_RUN,
            sources: [
                { id: 'block-1', kind: 'wire', label: 'first' },
                { id: 'block-1', kind: 'wire', label: 'again' }
            ]
        });
        const sourceStmts = inTransaction.filter(s => s.text.includes('inference_source'));
        expect(sourceStmts).toHaveLength(1);
        expect(sourceStmts[0].values).toContain('first');
    });

    it('caps sources at MAX_SOURCES', async () => {
        const many: RunSource[] = Array.from({ length: MAX_SOURCES + 20 }, (_, i) => ({
            id: `block-${i}`, kind: 'wire' as const, label: `b${i}`
        }));
        await openRun({ ...BASE_RUN, sources: many });
        expect(inTransaction.filter(s => s.text.includes('inference_source'))).toHaveLength(MAX_SOURCES);
    });

    it('writes no source rows when nothing fed the turn', async () => {
        await openRun(BASE_RUN);
        expect(inTransaction.filter(s => s.text.includes('inference_source'))).toHaveLength(0);
    });
});

// ============================================
// CLOSING A RUN
// ============================================

describe('terminal states', () => {
    it('success records output, tokens, finish reason and a latency', async () => {
        const run = await openRun(BASE_RUN);
        await run.succeeded({ output: 'the answer', tokensUsed: 812, finishReason: 'end_turn' });

        const [update] = finishCalls();
        expect(update.values[0]).toBe('17');
        expect(update.values[1]).toBe('succeeded');
        expect(update.values[2]).toBeGreaterThanOrEqual(0);
        expect(update.values[3]).toBe('the answer'.length);
        expect(update.values[4]).toBe('the answer');
        expect(update.values[5]).toBe(812);
        expect(update.values[6]).toBe('end_turn');
        expect(update.values[7]).toBeNull();
    });

    it('failure records a scrubbed message and no output', async () => {
        const run = await openRun(BASE_RUN);
        await run.failed(new Error('Anthropic error: 429'));

        const [update] = finishCalls();
        expect(update.values[1]).toBe('failed');
        expect(update.values[4]).toBeNull();
        expect(update.values[7]).toBe('Anthropic error: 429');
    });

    it('cancel is its own state, and keeps what was delivered', async () => {
        const run = await openRun(BASE_RUN);
        await run.canceled({ output: 'half an ans', finishReason: 'canceled' });

        const [update] = finishCalls();
        expect(update.values[1]).toBe('canceled');
        expect(update.values[4]).toBe('half an ans');
        // Not a failure: the partial answer is the user's, by their own Stop.
        expect(update.values[7]).toBeNull();
    });

    it('only closes a row that is still running, so one terminal state wins', async () => {
        const run = await openRun(BASE_RUN);
        await run.succeeded({ output: 'x' });
        expect(finishCalls()[0].text).toContain("status = 'running'");
    });
});

// ============================================
// STREAMING
// ============================================

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
        }
    });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        out += decoder.decode(value, { stream: true });
    }
    return out;
}

/** Records what the metered stream reported, without a database. */
function spyRun(): MeterableRun & { calls: Array<[string, unknown]> } {
    const calls: Array<[string, unknown]> = [];
    return {
        calls,
        async succeeded(o) { calls.push(['succeeded', o]); },
        async failed(e) { calls.push(['failed', e]); },
        async uncertain(e) { calls.push(['uncertain', e]); },
        async canceled(o) { calls.push(['canceled', o]); }
    };
}

describe('meterStream', () => {
    it('passes the provider stream through unchanged', async () => {
        const run = spyRun();
        await expect(readAll(meterStream(streamOf('Bitcoin ', 'is ', 'up.'), run)))
            .resolves.toBe('Bitcoin is up.');
    });

    it('records a completed stream as succeeded, with the delivered length', async () => {
        const run = spyRun();
        await readAll(meterStream(streamOf('Bitcoin ', 'is ', 'up.'), run));
        expect(run.calls).toHaveLength(1);
        const [state, outcome] = run.calls[0];
        expect(state).toBe('succeeded');
        expect(outcome).toMatchObject({
            output: 'Bitcoin is up.',
            outputChars: 'Bitcoin is up.'.length,
            finishReason: 'stop'
        });
    });

    it('records a reader cancel as canceled, keeping the partial answer', async () => {
        const run = spyRun();
        const metered = meterStream(streamOf('partial ', 'answer'), run);
        const reader = metered.getReader();
        await reader.read();               // take the first chunk
        await reader.cancel('user stop');  // then Stop

        expect(run.calls).toHaveLength(1);
        const [state, outcome] = run.calls[0];
        expect(state).toBe('canceled');
        expect(outcome).toMatchObject({ output: 'partial ', finishReason: 'canceled' });
    });

    it('records an ambiguous mid-stream break as uncertain and errors the consumer', async () => {
        const run = spyRun();
        const encoder = new TextEncoder();
        const broken = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('half'));
            },
            pull(controller) {
                controller.error(new Error('upstream closed'));
            }
        });

        await expect(readAll(meterStream(broken, run))).rejects.toThrow('upstream closed');
        expect(run.calls.map(c => c[0])).toEqual(['uncertain']);
    });

    it('closes the row exactly once', async () => {
        const run = spyRun();
        const metered = meterStream(streamOf('done'), run);
        await readAll(metered);
        await metered.cancel?.('late cancel').catch(() => { });
        expect(run.calls).toHaveLength(1);
    });

    it('counts a long stream in full but keeps only an excerpt', async () => {
        const run = spyRun();
        const chunk = 'x'.repeat(1000);
        await readAll(meterStream(streamOf(...Array(10).fill(chunk)), run));
        const [, outcome] = run.calls[0] as [string, { output: string; outputChars: number }];
        expect(outcome.outputChars).toBe(10_000);
        expect(outcome.output.length).toBeLessThanOrEqual(EXCERPT_LIMIT + chunk.length);
    });
});

// ============================================
// RULE 2 — NO CREDENTIAL IN A ROW
// ============================================

describe('scrubbing', () => {
    it('replaces a live provider key wherever it appears', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-supersecret-value-1234';
        const text = 'failed calling https://api.anthropic.com?k=sk-ant-supersecret-value-1234 twice: sk-ant-supersecret-value-1234';
        const scrubbed = scrubSecrets(text);
        expect(scrubbed).not.toContain('sk-ant-supersecret-value-1234');
        expect(scrubbed).toContain('[redacted:ANTHROPIC_API_KEY]');
    });

    it('replaces the connection string, which rides along on pg errors', () => {
        process.env.DATABASE_URL = 'postgres://omni:hunter2@localhost:5432/omni';
        expect(scrubSecrets('connect ECONNREFUSED postgres://omni:hunter2@localhost:5432/omni'))
            .not.toContain('hunter2');
    });

    it('ignores an unset or trivially short value', () => {
        process.env.GOOGLE_API_KEY = 'abc';
        expect(scrubSecrets('abcdefg')).toBe('abcdefg');
    });

    it('scrubs the stored error, not just the logged one', async () => {
        process.env.GOOGLE_API_KEY = 'AIza-secret-key-value-9999';
        const run = await openRun(BASE_RUN);
        await run.failed(new Error('Google error at ?key=AIza-secret-key-value-9999'));
        expect(String(finishCalls()[0].values[7])).not.toContain('AIza-secret-key-value-9999');
    });

    it('scrubs the prompt excerpt too — a key can be pasted into a chat', () => {
        process.env.ANTHROPIC_API_KEY = 'sk-ant-pasted-into-the-prompt';
        expect(promptExcerpt('here is my key sk-ant-pasted-into-the-prompt'))
            .not.toContain('sk-ant-pasted-into-the-prompt');
    });
});

describe('error normalization', () => {
    it('bounds the length', () => {
        expect(normalizeError(new Error('e'.repeat(5000))).length).toBeLessThanOrEqual(500);
    });

    it('flattens newlines so a row stays one line', () => {
        expect(normalizeError(new Error('line one\n  line two'))).toBe('line one line two');
    });

    it('never produces an empty message', () => {
        expect(normalizeError(new Error('   '))).toBe('Unknown error');
        expect(normalizeError(undefined)).toBe('Unknown error');
        expect(normalizeError({ weird: true })).toBe('Unknown error');
    });

    it('accepts a bare string', () => {
        expect(normalizeError('plain failure')).toBe('plain failure');
    });
});

// ============================================
// EXCERPTS — truncation must be visible
// ============================================

describe('excerpts', () => {
    it('keeps the tail of a prompt, where the task is', () => {
        const prompt = `${'context '.repeat(2000)}ANSWER THIS`;
        const excerpt = promptExcerpt(prompt)!;
        expect(excerpt.endsWith('ANSWER THIS')).toBe(true);
        expect(excerpt.startsWith('…')).toBe(true);
    });

    it('keeps the head of an answer, where the conclusion is', () => {
        const output = `CONCLUSION FIRST${'.'.repeat(EXCERPT_LIMIT * 2)}`;
        const excerpt = outputExcerpt(output)!;
        expect(excerpt.startsWith('CONCLUSION FIRST')).toBe(true);
        expect(excerpt.endsWith('…')).toBe(true);
        expect(excerpt.length).toBe(EXCERPT_LIMIT + 1);
    });

    it('marks a truncated prompt with a leading ellipsis', () => {
        const excerpt = promptExcerpt('y'.repeat(EXCERPT_LIMIT + 1))!;
        expect(excerpt.startsWith('…')).toBe(true);
        expect(excerpt.length).toBe(EXCERPT_LIMIT + 1);
    });

    it('leaves short text alone and distinguishes absent from empty', () => {
        expect(promptExcerpt('short')).toBe('short');
        expect(promptExcerpt(undefined)).toBeNull();
        expect(outputExcerpt(undefined)).toBeNull();
        expect(outputExcerpt('')).toBe('');
    });
});

// ============================================
// READ SIDE
// ============================================

const RAW_ROW = {
    id: '9',
    provider: 'local' as const,
    model: 'tinyllama',
    streamed: true,
    status: 'succeeded' as const,
    started_at: new Date('2026-09-22T10:00:00.000Z'),
    finished_at: new Date('2026-09-22T10:00:02.500Z'),
    latency_ms: 2500,
    message_count: 2,
    prompt_chars: 900,
    prompt_excerpt: 'what now?',
    temperature: 0.7,
    max_tokens: 2048,
    output_chars: 120,
    output_excerpt: 'because the data says',
    tokens_used: 300,
    finish_reason: 'stop',
    error: null
};

/**
 * Answer the run query from `runs` and the source lookup from `sources`.
 *
 * Discriminates on `source_id`, not on the table name: the lineage query
 * JOINs inference_source too, so a table-name match would hand the recursive
 * walk the source rows.
 */
function readback(runs: unknown[], sources: unknown[] = []) {
    const seen: Stmt[] = [];
    vi.mocked(query).mockImplementation(async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values: (values ?? []) as unknown[] });
        return { rows: (text.includes('source_id') ? sources : runs) as never[] };
    });
    return seen;
}

describe('recentRuns', () => {
    it('reads the newest first and attaches each run its sources', async () => {
        readback([RAW_ROW], [
            { run_id: '9', source_id: 'block-1', kind: 'wire', label: 'Polymarket' },
            { run_id: '9', source_id: 'pool-a', kind: 'memory', label: 'Memory' }
        ]);
        const [run] = await recentRuns();

        expect(run).toMatchObject({
            id: '9',
            provider: 'local',
            status: 'succeeded',
            startedAt: '2026-09-22T10:00:00.000Z',
            finishedAt: '2026-09-22T10:00:02.500Z',
            latencyMs: 2500,
            messageCount: 2,
            promptChars: 900,
            outputExcerpt: 'because the data says',
            tokensUsed: 300
        });
        expect(run.sources).toEqual([
            { id: 'block-1', kind: 'wire', label: 'Polymarket' },
            { id: 'pool-a', kind: 'memory', label: 'Memory' }
        ]);
    });

    it('orders by started_at then id, so equal timestamps stay stable', async () => {
        const seen = readback([RAW_ROW]);
        await recentRuns();
        expect(seen[0].text).toContain('ORDER BY started_at DESC, id DESC');
    });

    it('gives a run with no sources an empty array, not undefined', async () => {
        readback([RAW_ROW], []);
        expect((await recentRuns())[0].sources).toEqual([]);
    });

    it('skips the source lookup entirely when no runs matched', async () => {
        const seen = readback([]);
        await expect(recentRuns()).resolves.toEqual([]);
        expect(seen).toHaveLength(1);
    });

    it('binds filters as parameters and keeps them out of the SQL text', async () => {
        const seen = readback([RAW_ROW]);
        await recentRuns({ provider: 'anthropic', status: 'failed', limit: 5 });

        const runQuery = seen[0];
        expect(runQuery.text).toContain('provider = $1');
        expect(runQuery.text).toContain('status = $2');
        expect(runQuery.text).toContain('LIMIT $3');
        expect(runQuery.text).not.toContain('anthropic');
        expect(runQuery.values).toEqual(['anthropic', 'failed', 5]);
    });

    it('omits the WHERE clause when nothing is filtered', async () => {
        const seen = readback([RAW_ROW]);
        await recentRuns();
        expect(seen[0].text).not.toContain('WHERE');
        expect(seen[0].values).toEqual([DEFAULT_RUN_LIMIT]);
    });

    it('looks sources up by the run ids it just read', async () => {
        const seen = readback([RAW_ROW, { ...RAW_ROW, id: '10' }]);
        await recentRuns();
        expect(seen[1].text).toContain('run_id = ANY($1::bigint[])');
        expect(seen[1].values).toEqual([['9', '10']]);
    });
});

describe('clampLimit', () => {
    it('defaults when absent or not a number', () => {
        expect(clampLimit()).toBe(DEFAULT_RUN_LIMIT);
        expect(clampLimit(NaN)).toBe(DEFAULT_RUN_LIMIT);
        expect(clampLimit(Infinity)).toBe(DEFAULT_RUN_LIMIT);
    });

    it('holds the page to one bounded read', () => {
        expect(clampLimit(0)).toBe(1);
        expect(clampLimit(-7)).toBe(1);
        expect(clampLimit(10_000)).toBe(MAX_RUN_LIMIT);
        expect(clampLimit(7.9)).toBe(7);
    });
});

describe('normalizePostgresBigintId', () => {
    it('keeps a bigint-sized decimal and strips leading zeros', () => {
        expect(normalizePostgresBigintId('9223372036854775807')).toBe('9223372036854775807');
        expect(normalizePostgresBigintId('0007')).toBe('7');
    });

    it('refuses what a bigint cast would reject', () => {
        expect(normalizePostgresBigintId('9223372036854775808')).toBeUndefined();
        expect(normalizePostgresBigintId('12345678901234567890')).toBeUndefined();
        expect(normalizePostgresBigintId('abc')).toBeUndefined();
    });
});

// ============================================
// LINEAGE — the cascade edge
// ============================================

describe('recording a cascade edge', () => {
    it('stores the parent run for an inference source', async () => {
        await openRun({
            ...BASE_RUN,
            sources: [{ id: 'persona-2', kind: 'inference', label: 'Analyst', parentRunId: '8' }]
        });
        const insert = stmt(inTransaction, 'INSERT INTO inference_source');
        expect(insert.values).toEqual(['17', 'persona-2', 'inference', 'Analyst', '8']);
    });

    it('binds the parent as a parameter, never into the SQL', async () => {
        await openRun({
            ...BASE_RUN,
            sources: [{ id: 'p', kind: 'inference', label: 'A', parentRunId: '8' }]
        });
        const insert = stmt(inTransaction, 'INSERT INTO inference_source');
        expect(insert.text).toContain('$5');
        expect(insert.text).not.toContain('8');
    });

    // The CHECK constraint refuses it, so sending it would cost the whole
    // transaction — and with it the run row. The kind decides, not the caller.
    it('drops a parent offered on a non-inference source', async () => {
        await openRun({
            ...BASE_RUN,
            sources: [
                { id: 'block-1', kind: 'wire', label: 'Polymarket', parentRunId: '8' },
                { id: 'pool-a', kind: 'memory', label: 'Memory', parentRunId: '9' }
            ]
        });
        const inserts = inTransaction.filter(s => s.text.includes('inference_source'));
        expect(inserts[0].values[4]).toBeNull();
        expect(inserts[1].values[4]).toBeNull();
    });

    it('writes an inference source with no parent when the upstream was unrecorded', async () => {
        await openRun({
            ...BASE_RUN,
            sources: [{ id: 'persona-2', kind: 'inference', label: 'Analyst' }]
        });
        expect(stmt(inTransaction, 'INSERT INTO inference_source').values[4]).toBeNull();
    });
});

/** Build a lineage row as the recursive CTE would return it. */
function lineageRow(
    id: string,
    depth: number,
    childRunId: string | null,
    viaLabel: string | null,
    isCycle = false
) {
    return {
        ...RAW_ROW,
        id,
        depth,
        is_cycle: isCycle,
        child_run_id: childRunId,
        via_label: viaLabel
    };
}

describe('runLineage', () => {
    it('is empty without a database, and does not query', async () => {
        vi.mocked(isDatabaseConfigured).mockReturnValue(false);
        await expect(runLineage('9')).resolves.toEqual({
            root: null, nodes: [], hadCycle: false, truncated: false
        });
        expect(query).not.toHaveBeenCalled();
    });

    it('asks for the run, a depth bound and a node cap, all bound', async () => {
        const seen = readback([lineageRow('9', 0, null, null)]);
        await runLineage('9', 4);

        expect(seen[0].text).toContain('WITH RECURSIVE');
        expect(seen[0].values).toEqual(['9', 4, MAX_LINEAGE_NODES]);
    });

    it('walks child to parent on parent_run_id', async () => {
        const seen = readback([lineageRow('9', 0, null, null)]);
        await runLineage('9');
        expect(seen[0].text).toContain('s.parent_run_id IS NOT NULL');
        expect(seen[0].text).toContain('parent.id = s.parent_run_id');
    });

    it('bounds the recursion by depth as well as by the path', async () => {
        const seen = readback([lineageRow('9', 0, null, null)]);
        await runLineage('9');
        expect(seen[0].text).toContain('l.depth < $2');
        expect(seen[0].text).toContain('NOT l.is_cycle');
        expect(seen[0].text).toContain('ANY(l.path)');
    });

    it('qualifies the run columns, since the CTE also has an id', async () => {
        const seen = readback([lineageRow('9', 0, null, null)]);
        await runLineage('9');
        expect(seen[0].text).toContain('inference_run.id');
    });

    it('returns the asked-about run as the root at depth 0', async () => {
        readback([
            lineageRow('9', 0, null, null),
            lineageRow('8', 1, '9', 'Analyst')
        ]);
        const lineage = await runLineage('9');

        expect(lineage.root?.id).toBe('9');
        expect(lineage.nodes).toHaveLength(2);
        expect(lineage.nodes[1]).toMatchObject({
            depth: 1,
            childRunId: '9',
            viaLabel: 'Analyst',
            isCycle: false
        });
        expect(lineage.nodes[1].run.id).toBe('8');
    });

    it('attaches every level its own sources', async () => {
        readback(
            [lineageRow('9', 0, null, null), lineageRow('8', 1, '9', 'Analyst')],
            [
                { run_id: '9', source_id: 'persona-1', kind: 'inference', label: 'Analyst', parent_run_id: '8' },
                { run_id: '8', source_id: 'block-1', kind: 'wire', label: 'Polymarket', parent_run_id: null }
            ]
        );
        const lineage = await runLineage('9');

        // The root cites a run; the run it cites is grounded in raw data.
        expect(lineage.nodes[0].run.sources).toEqual([
            { id: 'persona-1', kind: 'inference', label: 'Analyst', parentRunId: '8' }
        ]);
        expect(lineage.nodes[1].run.sources).toEqual([
            { id: 'block-1', kind: 'wire', label: 'Polymarket' }
        ]);
    });

    it('looks sources up for every run the walk returned', async () => {
        const seen = readback([lineageRow('9', 0, null, null), lineageRow('8', 1, '9', 'A')]);
        await runLineage('9');
        expect(seen[1].values).toEqual([['9', '8']]);
    });

    it('reports a cycle the walk refused to follow', async () => {
        readback([
            lineageRow('9', 0, null, null),
            lineageRow('8', 1, '9', 'Analyst'),
            lineageRow('9', 2, '8', 'Strategist', true)
        ]);
        const lineage = await runLineage('9');
        expect(lineage.hadCycle).toBe(true);
        expect(lineage.nodes[2].isCycle).toBe(true);
    });

    it('is not truncated when the deepest run cites no further run', async () => {
        readback(
            [lineageRow('9', 0, null, null), lineageRow('8', 1, '9', 'Analyst')],
            [{ run_id: '8', source_id: 'block-1', kind: 'wire', label: 'Polymarket', parent_run_id: null }]
        );
        expect((await runLineage('9', 1)).truncated).toBe(false);
    });

    it('is truncated when a run at the depth limit still cites a parent', async () => {
        readback(
            [lineageRow('9', 0, null, null), lineageRow('8', 1, '9', 'Analyst')],
            [{ run_id: '8', source_id: 'persona-0', kind: 'inference', label: 'Scout', parent_run_id: '7' }]
        );
        expect((await runLineage('9', 1)).truncated).toBe(true);
    });

    it('does not call a cycle at the depth limit truncation', async () => {
        readback(
            [lineageRow('9', 0, null, null), lineageRow('9', 1, '9', 'Loop', true)],
            [{ run_id: '9', source_id: 'p', kind: 'inference', label: 'Loop', parent_run_id: '9' }]
        );
        const lineage = await runLineage('9', 1);
        expect(lineage.hadCycle).toBe(true);
        expect(lineage.truncated).toBe(false);
    });

    it('returns a null root for an unknown run', async () => {
        readback([]);
        expect((await runLineage('404')).root).toBeNull();
    });
});

describe('clampDepth', () => {
    it('defaults when absent or not a number', () => {
        expect(clampDepth()).toBe(DEFAULT_LINEAGE_DEPTH);
        expect(clampDepth(NaN)).toBe(DEFAULT_LINEAGE_DEPTH);
    });

    it('allows 0 — the run alone, with no walk', () => {
        expect(clampDepth(0)).toBe(0);
    });

    it('bounds the recursion', () => {
        expect(clampDepth(-3)).toBe(0);
        expect(clampDepth(9999)).toBe(MAX_LINEAGE_DEPTH);
    });
});
