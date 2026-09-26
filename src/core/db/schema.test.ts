// ============================================
// LEDGER SCHEMA — the constraints the writer relies on.
//
// The ledger module makes claims that only the database can enforce: a
// terminal row has a duration, a canceled run is not a failure, a source
// cannot be cited twice, and deleting a run takes its provenance with it.
// If a migration quietly drops one of those, the claims in
// INFERENCE_LEDGER.md become false while every unit test still passes.
// This reads the SQL and checks they are still declared.
//
// Migrations are append-only, so this asserts against 001 by name.
// ============================================

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'db', 'migrations');
const sql = readFileSync(path.join(MIGRATIONS_DIR, '001_inference_ledger.sql'), 'utf8');
const lineageSql = readFileSync(path.join(MIGRATIONS_DIR, '002_run_lineage.sql'), 'utf8');
const hostedSql = readFileSync(path.join(MIGRATIONS_DIR, '003_hosted_ownership_idempotency.sql'), 'utf8');

const flat = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();

/** Whitespace-insensitive search: the SQL is formatted for humans. */
function declares(fragment: string): boolean {
    return flat(sql).includes(flat(fragment));
}

function declaresInLineage(fragment: string): boolean {
    return flat(lineageSql).includes(flat(fragment));
}

describe('migration files', () => {
    it('are numbered so filename order is apply order', () => {
        const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql'));
        expect(files.length).toBeGreaterThan(0);
        for (const f of files) {
            expect(f).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/);
        }
        expect([...files].sort()).toEqual(files.slice().sort());
    });

    it('are re-runnable, so a half-applied database can be repaired', () => {
        for (const text of [sql, lineageSql, hostedSql]) {
            expect(text).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)/i);
            expect(text).not.toMatch(/CREATE INDEX(?! IF NOT EXISTS)/i);
            expect(text).not.toMatch(/ADD COLUMN(?! IF NOT EXISTS)/i);
        }
    });

    it('guards every added constraint in the hosted migration', () => {
        const constraintAdds = (hostedSql.match(/ADD CONSTRAINT/gi) ?? []).length;
        const guards = (hostedSql.match(/FROM pg_constraint/gi) ?? []).length;
        expect(constraintAdds).toBeGreaterThan(0);
        expect(guards).toBeGreaterThanOrEqual(constraintAdds);
    });

    it('guard added constraints, which have no IF NOT EXISTS', () => {
        // ALTER TABLE ... ADD CONSTRAINT is not idempotent in Postgres, so 002
        // checks pg_constraint first. Without that, a re-run fails.
        const constraintAdds = (lineageSql.match(/ADD CONSTRAINT/gi) ?? []).length;
        const guards = (lineageSql.match(/FROM pg_constraint/gi) ?? []).length;
        expect(constraintAdds).toBeGreaterThan(0);
        expect(guards).toBe(constraintAdds);
    });
});

describe('002 — run lineage', () => {
    it('makes the cascade edge a real foreign key', () => {
        expect(declaresInLineage('parent_run_id BIGINT REFERENCES inference_run (id)')).toBe(true);
    });

    it('sets the edge NULL rather than deleting the child run record', () => {
        // CASCADE here would mean deleting an upstream run erases the
        // downstream run's record of having consumed anything at all.
        expect(declaresInLineage('ON DELETE SET NULL')).toBe(true);
        expect(flat(lineageSql)).not.toContain('parent_run_id bigint references inference_run (id) on delete cascade');
    });

    it('lets only an inference source name a parent run', () => {
        expect(declaresInLineage('inference_source_parent_only_for_inference')).toBe(true);
        expect(declaresInLineage("parent_run_id IS NULL OR kind = 'inference'")).toBe(true);
    });

    it('refuses the one-step cycle outright', () => {
        expect(declaresInLineage('inference_source_no_self_parent')).toBe(true);
        expect(declaresInLineage('parent_run_id IS NULL OR parent_run_id <> run_id')).toBe(true);
    });

    it('indexes the column the recursive walk joins on every iteration', () => {
        expect(declaresInLineage('ON inference_source (parent_run_id)')).toBe(true);
        expect(declaresInLineage('WHERE parent_run_id IS NOT NULL')).toBe(true);
    });
});

describe('003 — hosted identity and idempotency', () => {
    it('keeps historical rows ownerless and adds stable owner/idempotency columns', () => {
        expect(flat(hostedSql)).toContain('add column if not exists owner_id text');
        expect(flat(hostedSql)).toContain('add column if not exists idempotency_key text');
        expect(flat(hostedSql)).toContain('add column if not exists request_digest text');
        expect(flat(hostedSql)).not.toContain('update inference_run set owner_id');
    });

    it('enforces unique owner key pairs and permits uncertain terminal outcomes', () => {
        expect(flat(hostedSql)).toContain('on inference_run (owner_id, idempotency_key)');
        expect(flat(hostedSql)).toContain("'uncertain'");
        expect(flat(hostedSql)).toContain("status in ('failed', 'uncertain') or error is null");
    });
});

describe('inference_run', () => {
    it('constrains provider and status to the values the code writes', () => {
        expect(declares("provider IN ('local', 'anthropic', 'google')")).toBe(true);
        expect(declares("status IN ('running', 'succeeded', 'failed', 'canceled')")).toBe(true);
    });

    it('requires a terminal row to have an end and a duration', () => {
        expect(declares('CONSTRAINT inference_run_terminal_shape')).toBe(true);
        expect(declares("status = 'running' AND finished_at IS NULL AND latency_ms IS NULL")).toBe(true);
        expect(declares("status <> 'running' AND finished_at IS NOT NULL AND latency_ms IS NOT NULL")).toBe(true);
    });

    it('lets only a failure carry an error — cancel is not a failure', () => {
        expect(declares('CONSTRAINT inference_run_error_only_on_failure')).toBe(true);
        expect(declares("status = 'failed' OR error IS NULL")).toBe(true);
    });

    it('rejects negative durations and counts', () => {
        expect(declares('latency_ms >= 0')).toBe(true);
        expect(declares('message_count > 0')).toBe(true);
        expect(declares('prompt_chars >= 0')).toBe(true);
        expect(declares('output_chars >= 0')).toBe(true);
        expect(declares('tokens_used >= 0')).toBe(true);
    });

    it('indexes the reads /api/inference-runs performs', () => {
        expect(declares('ON inference_run (started_at DESC, id DESC)')).toBe(true);
        expect(declares('ON inference_run (provider, started_at DESC)')).toBe(true);
        expect(declares("WHERE status = 'failed'")).toBe(true);
    });
});

describe('inference_source', () => {
    it('cascades from its run, so deleting a run takes its provenance', () => {
        expect(declares('REFERENCES inference_run (id) ON DELETE CASCADE')).toBe(true);
    });

    it('cannot cite the same source twice for one run', () => {
        expect(declares('PRIMARY KEY (run_id, source_id)')).toBe(true);
    });

    it('constrains kind to the canvas provenance kinds', () => {
        expect(declares("kind IN ('wire', 'memory', 'inference')")).toBe(true);
    });
});
