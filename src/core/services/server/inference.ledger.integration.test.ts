// ============================================
// INFERENCE LEDGER — against a real Postgres.
//
// Skipped unless OMNI_TEST_DATABASE_URL is set, so CI and a normal
// `npm test` stay dependency-free. Run it against a scratch database:
//
//   OMNI_TEST_DATABASE_URL=postgres://localhost/omni_test npm test
//
// A separate variable on purpose: a test that truncates tables must not be
// able to point at the DATABASE_URL a developer is actually using.
//
// The unit tests prove the module's logic with a mocked driver; only this one
// proves the CHECK constraints, the foreign key and the indexed read are real.
// ============================================

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';

const TEST_URL = process.env.OMNI_TEST_DATABASE_URL?.trim();
const live = describe.skipIf(!TEST_URL);

let pool: Pool;

// The module reads DATABASE_URL at query time, so point it at the scratch
// database for this file only and load the ledger after it is set.
type Ledger = typeof import('./inference.ledger');
let ledger: Ledger;
let savedDatabaseUrl: string | undefined;

beforeAll(async () => {
    if (!TEST_URL) return;
    savedDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = TEST_URL;

    pool = new Pool({ connectionString: TEST_URL, max: 2 });
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    // Every migration, in order — the same thing `npm run db:migrate` does,
    // minus the schema_migrations bookkeeping this file does not need.
    const dir = path.join(process.cwd(), 'db', 'migrations');
    const { readdirSync } = await import('node:fs');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
        await pool.query(readFileSync(path.join(dir, file), 'utf8'));
    }

    ledger = await import('./inference.ledger');
});

beforeEach(async () => {
    if (!TEST_URL) return;
    // One test's connection hiccup must not silently disable the ledger for
    // the rest of the file.
    ledger.resetLedgerCooldown();
    // inference_source goes with it, by the cascade this suite asserts.
    await pool.query('TRUNCATE inference_run CASCADE');
});

afterAll(async () => {
    if (!TEST_URL) return;
    await pool.end();
    const { closePool } = await import('@/core/db/client');
    await closePool();
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
});

const BASE = {
    provider: 'anthropic' as const,
    model: 'claude-opus-5',
    streamed: false,
    messageCount: 2,
    promptChars: 42
};

live('the schema enforces what the module claims', () => {
    it('opens a running row with no end and no duration', async () => {
        const run = await ledger.openRun(BASE);
        expect(run.id).not.toBeNull();

        const { rows } = await pool.query(
            'SELECT status, finished_at, latency_ms FROM inference_run WHERE id = $1',
            [run.id]
        );
        expect(rows[0]).toMatchObject({ status: 'running', finished_at: null, latency_ms: null });
    });

    it('replays a same-owner idempotency key and rejects changed input', async () => {
        const first = await ledger.openRun({
            ...BASE, ownerId: 'issuer:alice', idempotencyKey: 'logical-op-1', requestDigest: 'a'.repeat(64)
        });
        const replay = await ledger.openRun({
            ...BASE, ownerId: 'issuer:alice', idempotencyKey: 'logical-op-1', requestDigest: 'a'.repeat(64)
        });
        const changed = await ledger.openRun({
            ...BASE, ownerId: 'issuer:alice', idempotencyKey: 'logical-op-1', requestDigest: 'b'.repeat(64)
        });

        expect(first.id).not.toBeNull();
        expect(replay).toMatchObject({ id: first.id, replay: true, status: 'running', idempotencyConflict: false });
        expect(changed).toMatchObject({ id: first.id, replay: true, idempotencyConflict: true });
        const { rows } = await pool.query('SELECT count(*)::int AS count FROM inference_run');
        expect(rows[0].count).toBe(1);
    });

    it('serializes concurrent requests with the same owner and key to one row', async () => {
        const input = {
            ...BASE, ownerId: 'issuer:concurrent', idempotencyKey: 'same-key', requestDigest: 'c'.repeat(64)
        };
        const [first, second] = await Promise.all([ledger.openRun(input), ledger.openRun(input)]);
        expect(first.id).toBe(second.id);
        expect([first.replay, second.replay].filter(Boolean)).toHaveLength(1);
        const { rows } = await pool.query('SELECT count(*)::int AS count FROM inference_run');
        expect(rows[0].count).toBe(1);
    });

    it('rejects a parent run owned by a different user without leaving a child row', async () => {
        const parent = await ledger.openRun({ ...BASE, ownerId: 'issuer:bob' });
        const child = await ledger.openRun({
            ...BASE,
            ownerId: 'issuer:alice',
            sources: [{ id: parent.id!, kind: 'inference', label: 'Other user', parentRunId: parent.id! }]
        });
        expect(child.parentRejected).toBe(true);
        const { rows } = await pool.query('SELECT owner_id FROM inference_run ORDER BY id');
        expect(rows.map(row => row.owner_id)).toEqual(['issuer:bob']);
    });

    it('rejects an out-of-range parent id without tripping the ledger cooldown', async () => {
        const rejected = await ledger.openRun({
            ...BASE,
            ownerId: 'issuer:alice',
            idempotencyKey: 'invalid-parent',
            requestDigest: 'd'.repeat(64),
            sources: [{ id: 'bad-parent', kind: 'inference', label: 'Invalid parent', parentRunId: '9999999999999999999' }]
        });
        expect(rejected).toMatchObject({ id: null, parentRejected: true });

        const valid = await ledger.openRun({
            ...BASE, ownerId: 'issuer:bob', idempotencyKey: 'valid-after-invalid', requestDigest: 'e'.repeat(64)
        });
        expect(valid.id).not.toBeNull();
        const { rows } = await pool.query('SELECT owner_id FROM inference_run');
        expect(rows.map(row => row.owner_id)).toEqual(['issuer:bob']);
    });

    it('hides a legacy cross-owner ancestor and its source details from an owned lineage', async () => {
        const foreign = await ledger.openRun({
            ...BASE, ownerId: 'issuer:bob',
            sources: [{ id: 'secret-source', kind: 'wire', label: 'Bob private context' }]
        });
        const intermediate = await ledger.openRun({ ...BASE, ownerId: 'issuer:alice' });
        const root = await ledger.openRun({
            ...BASE, ownerId: 'issuer:alice',
            sources: [{ id: 'intermediate', kind: 'inference', label: 'Prior turn', parentRunId: intermediate.id! }]
        });
        // Model a historical row or out-of-band repair predating owner checks.
        await pool.query(
            `INSERT INTO inference_source (run_id, source_id, kind, label, parent_run_id)
             VALUES ($1, 'foreign-edge', 'inference', 'cross-owner legacy edge', $2)`,
            [intermediate.id, foreign.id]
        );

        const lineage = await ledger.runLineage(root.id!, 8, 'issuer:alice');
        expect(lineage.nodes.map(node => node.run.id)).toEqual([root.id, intermediate.id]);
        expect(lineage.nodes.flatMap(node => node.run.sources).map(source => source.id))
            .not.toContain('secret-source');
        expect(lineage.nodes.flatMap(node => node.run.sources).map(source => source.label))
            .not.toContain('Bob private context');
    });

    it('keeps ambiguous hosted outcomes terminal and hidden across owner scopes', async () => {
        const first = await ledger.openRun({ ...BASE, ownerId: 'issuer:alice' });
        await first.uncertain(new Error('upstream connection lost'));
        const own = await ledger.recentRuns({ ownerId: 'issuer:alice' });
        const other = await ledger.recentRuns({ ownerId: 'issuer:bob' });
        expect(own.map(row => row.status)).toEqual(['uncertain']);
        expect(other).toEqual([]);
    });

    it('closes a success with a duration and reads it back through recentRuns', async () => {
        const run = await ledger.openRun({
            ...BASE,
            prompt: 'what is the market saying?',
            temperature: 0.5,
            maxTokens: 2048,
            sources: [
                { id: 'block-1', kind: 'wire', label: 'Polymarket' },
                { id: 'pool-a', kind: 'memory', label: 'Memory' }
            ]
        });
        await run.succeeded({ output: 'It is pricing 34%.', tokensUsed: 511, finishReason: 'end_turn' });

        const [row] = await ledger.recentRuns({ limit: 10 });
        expect(row.status).toBe('succeeded');
        expect(row.latencyMs).toBeGreaterThanOrEqual(0);
        expect(row.finishedAt).not.toBeNull();
        expect(row.tokensUsed).toBe(511);
        expect(row.promptExcerpt).toBe('what is the market saying?');
        expect(row.outputExcerpt).toBe('It is pricing 34%.');
        expect(row.sources.map(s => s.id).sort()).toEqual(['block-1', 'pool-a']);
    });

    it('records a failure with its message and no output', async () => {
        const run = await ledger.openRun(BASE);
        await run.failed(new Error('Anthropic error: 429'));

        const [row] = await ledger.recentRuns();
        expect(row.status).toBe('failed');
        expect(row.error).toBe('Anthropic error: 429');
        expect(row.outputExcerpt).toBeNull();
    });

    it('records a cancel as canceled, with the partial answer and no error', async () => {
        const run = await ledger.openRun({ ...BASE, streamed: true });
        await run.canceled({ output: 'half an ans', finishReason: 'canceled' });

        const [row] = await ledger.recentRuns();
        expect(row.status).toBe('canceled');
        expect(row.outputExcerpt).toBe('half an ans');
        expect(row.error).toBeNull();
    });

    it('refuses a second terminal write, so the first outcome stands', async () => {
        const run = await ledger.openRun(BASE);
        await run.succeeded({ output: 'first' });
        await run.failed(new Error('late failure'));

        const [row] = await ledger.recentRuns();
        expect(row.status).toBe('succeeded');
        expect(row.error).toBeNull();
    });

    it('rejects a terminal row with no duration', async () => {
        await expect(
            pool.query(
                `INSERT INTO inference_run (provider, model, streamed, status, message_count, prompt_chars)
                 VALUES ('local', 'tinyllama', false, 'succeeded', 1, 0)`
            )
        ).rejects.toThrow(/inference_run_terminal_shape/);
    });

    it('rejects an error message on a non-failure', async () => {
        await expect(
            pool.query(
                `INSERT INTO inference_run
                    (provider, model, streamed, status, message_count, prompt_chars,
                     finished_at, latency_ms, error)
                 VALUES ('local', 'tinyllama', false, 'canceled', 1, 0, now(), 5, 'not a failure')`
            )
        ).rejects.toThrow(/inference_run_error_only_on_failure/);
    });

    it('rejects an unknown provider', async () => {
        await expect(
            pool.query(
                `INSERT INTO inference_run (provider, model, streamed, status, message_count, prompt_chars)
                 VALUES ('openai', 'gpt-4', false, 'running', 1, 0)`
            )
        ).rejects.toThrow(/provider/);
    });

    it('rejects a source with no run', async () => {
        await expect(
            pool.query(
                `INSERT INTO inference_source (run_id, source_id, kind, label)
                 VALUES (999999, 'block-1', 'wire', 'orphan')`
            )
        ).rejects.toThrow(/foreign key|inference_source_run_id_fkey/i);
    });

    it('deletes provenance with its run', async () => {
        const run = await ledger.openRun({
            ...BASE,
            sources: [{ id: 'block-1', kind: 'wire', label: 'Polymarket' }]
        });
        await run.succeeded({ output: 'x' });

        await pool.query('DELETE FROM inference_run WHERE id = $1', [run.id]);
        const { rows } = await pool.query('SELECT count(*)::int AS n FROM inference_source');
        expect(rows[0].n).toBe(0);
    });

    it('filters and orders newest first', async () => {
        const a = await ledger.openRun({ ...BASE, provider: 'local', model: 'tinyllama' });
        await a.succeeded({ output: 'first' });
        const b = await ledger.openRun({ ...BASE, provider: 'anthropic' });
        await b.failed(new Error('boom'));

        const all = await ledger.recentRuns();
        expect(all.map(r => r.id)).toEqual([b.id, a.id]);

        expect((await ledger.recentRuns({ provider: 'local' })).map(r => r.id)).toEqual([a.id]);
        expect((await ledger.recentRuns({ status: 'failed' })).map(r => r.id)).toEqual([b.id]);
        expect(await ledger.recentRuns({ provider: 'google' })).toEqual([]);
    });

    it('uses the started_at index for the recent-runs read', async () => {
        const { rows } = await pool.query(
            `EXPLAIN SELECT id FROM inference_run ORDER BY started_at DESC, id DESC LIMIT 25`
        );
        // Empty tables get a seq scan regardless, so this asserts the index
        // exists and is usable rather than that the planner picked it.
        const indexes = await pool.query(
            `SELECT indexname FROM pg_indexes WHERE tablename = 'inference_run'`
        );
        expect(indexes.rows.map(r => r.indexname)).toContain('inference_run_started_at_idx');
        expect(rows.length).toBeGreaterThan(0);
    });
});

live('lineage walks a real cascade', () => {
    /**
     * Build a chain: each run cites the previous one's answer as an inference
     * source, exactly as `aggregateWireContext` does on the canvas.
     * Returns the run ids, oldest first.
     */
    async function chain(length: number): Promise<string[]> {
        const ids: string[] = [];
        for (let i = 0; i < length; i++) {
            const parent = ids.at(-1);
            const run = await ledger.openRun({
                ...BASE,
                model: `persona-${i}`,
                sources: parent
                    ? [{ id: `persona-${i - 1}`, kind: 'inference', label: `Persona ${i - 1}`, parentRunId: parent }]
                    : [{ id: 'block-poly', kind: 'wire', label: 'Polymarket' }]
            });
            await run.succeeded({ output: `answer ${i}` });
            ids.push(run.id!);
        }
        return ids;
    }

    it('returns just the run when nothing fed it', async () => {
        const [only] = await chain(1);
        const lineage = await ledger.runLineage(only);

        expect(lineage.root?.id).toBe(only);
        expect(lineage.nodes).toHaveLength(1);
        expect(lineage.nodes[0].depth).toBe(0);
        expect(lineage.nodes[0].childRunId).toBeNull();
        expect(lineage.hadCycle).toBe(false);
        expect(lineage.truncated).toBe(false);
    });

    it('walks a three-deep cascade from the final answer to the raw data', async () => {
        const [first, second, third] = await chain(3);
        const lineage = await ledger.runLineage(third);

        expect(lineage.nodes.map(n => [n.depth, n.run.id])).toEqual([
            [0, third],
            [1, second],
            [2, first]
        ]);

        // Each node names the run it fed and the chip it was cited under.
        expect(lineage.nodes[1]).toMatchObject({ childRunId: third, viaLabel: 'Persona 1' });
        expect(lineage.nodes[2]).toMatchObject({ childRunId: second, viaLabel: 'Persona 0' });

        // The point of the whole exercise: the raw block that grounds the
        // chain is three hops from the answer, and it is still reachable.
        expect(lineage.nodes[2].run.sources).toEqual([
            { id: 'block-poly', kind: 'wire', label: 'Polymarket' }
        ]);
        expect(lineage.truncated).toBe(false);
    });

    it('stops at the requested depth and says it was truncated', async () => {
        const [, second, third] = await chain(3);
        const lineage = await ledger.runLineage(third, 1);

        expect(lineage.nodes.map(n => n.run.id)).toEqual([third, second]);
        expect(lineage.truncated).toBe(true);
    });

    it('depth 0 returns the run alone without walking', async () => {
        const ids = await chain(3);
        const lineage = await ledger.runLineage(ids[2], 0);
        expect(lineage.nodes).toHaveLength(1);
        expect(lineage.truncated).toBe(true);
    });

    it('terminates on a cycle and reports it', async () => {
        // Two personas wired to each other: A cites B, then B cites A. The
        // canvas allows this (planCascade detects and breaks it), so the
        // recursive walk must not run away.
        const a = await ledger.openRun({ ...BASE, model: 'A' });
        await a.succeeded({ output: 'a' });
        const b = await ledger.openRun({
            ...BASE,
            model: 'B',
            sources: [{ id: 'persona-a', kind: 'inference', label: 'A', parentRunId: a.id! }]
        });
        await b.succeeded({ output: 'b' });

        // Close the loop: A also consumed B.
        await pool.query(
            `INSERT INTO inference_source (run_id, source_id, kind, label, parent_run_id)
             VALUES ($1, 'persona-b', 'inference', 'B', $2)`,
            [a.id, b.id]
        );

        const lineage = await ledger.runLineage(b.id!);
        expect(lineage.hadCycle).toBe(true);
        // b → a → b(cycle), and no further.
        expect(lineage.nodes.map(n => n.run.id)).toEqual([b.id, a.id, b.id]);
        expect(lineage.nodes[2].isCycle).toBe(true);
    });

    it('handles a diamond, where two runs feed one', async () => {
        const left = await ledger.openRun({ ...BASE, model: 'left' });
        await left.succeeded({ output: 'l' });
        const right = await ledger.openRun({ ...BASE, model: 'right' });
        await right.succeeded({ output: 'r' });

        const merged = await ledger.openRun({
            ...BASE,
            model: 'merged',
            sources: [
                { id: 'persona-l', kind: 'inference', label: 'Left', parentRunId: left.id! },
                { id: 'persona-r', kind: 'inference', label: 'Right', parentRunId: right.id! }
            ]
        });
        await merged.succeeded({ output: 'both' });

        const lineage = await ledger.runLineage(merged.id!);
        expect(lineage.nodes).toHaveLength(3);
        expect(lineage.nodes.filter(n => n.depth === 1).map(n => n.run.id).sort())
            .toEqual([left.id, right.id].sort());
        expect(lineage.hadCycle).toBe(false);
    });

    it('survives losing an upstream run — the edge goes null, the row stays', async () => {
        const [first, second] = await chain(2);
        await pool.query('DELETE FROM inference_run WHERE id = $1', [first]);

        // ON DELETE SET NULL, so the downstream run still records that it
        // consumed a persona; it just cannot say which run any more.
        const lineage = await ledger.runLineage(second);
        expect(lineage.nodes).toHaveLength(1);
        expect(lineage.nodes[0].run.sources).toEqual([
            { id: 'persona-0', kind: 'inference', label: 'Persona 0' }
        ]);
    });

    it('refuses a parent on a non-inference source', async () => {
        // A DIFFERENT run as the parent, so this can only trip the
        // kind constraint and not also the self-parent one.
        const other = await ledger.openRun(BASE);
        await other.succeeded({ output: 'other' });
        const run = await ledger.openRun(BASE);
        await run.succeeded({ output: 'x' });

        await expect(
            pool.query(
                `INSERT INTO inference_source (run_id, source_id, kind, label, parent_run_id)
                 VALUES ($1, 'block-1', 'wire', 'Polymarket', $2)`,
                [run.id, other.id]
            )
        ).rejects.toThrow(/inference_source_parent_only_for_inference/);
    });

    it('refuses a run that is its own parent', async () => {
        const run = await ledger.openRun(BASE);
        await run.succeeded({ output: 'x' });
        await expect(
            pool.query(
                `INSERT INTO inference_source (run_id, source_id, kind, label, parent_run_id)
                 VALUES ($1, 'self', 'inference', 'Itself', $1)`,
                [run.id]
            )
        ).rejects.toThrow(/inference_source_no_self_parent/);
    });

    it('refuses a parent that is not a run', async () => {
        const run = await ledger.openRun(BASE);
        await run.succeeded({ output: 'x' });
        await expect(
            pool.query(
                `INSERT INTO inference_source (run_id, source_id, kind, label, parent_run_id)
                 VALUES ($1, 'ghost', 'inference', 'Ghost', 999999)`,
                [run.id]
            )
        ).rejects.toThrow(/foreign key|fkey/i);
    });

    it('has the index the recursive join needs', async () => {
        const { rows } = await pool.query(
            `SELECT indexname FROM pg_indexes WHERE tablename = 'inference_source'`
        );
        expect(rows.map(r => r.indexname)).toContain('inference_source_parent_run_idx');
    });
});
