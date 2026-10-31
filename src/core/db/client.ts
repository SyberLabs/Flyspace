// ============================================
// PROJECT OMNI: POSTGRES CLIENT
//
// The one place DATABASE_URL is read. 'server-only' makes importing this
// from a client component a build error, so the connection string cannot
// follow the same route the provider API keys were pulled off of.
//
// Postgres is OPTIONAL. Without DATABASE_URL there is no pool, every query
// is a no-op, and the canvas runs exactly as it did before — local-first is
// the floor, not a degraded mode. See INFERENCE_LEDGER.md.
// ============================================

import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { errorKind, logEvent } from '@/core/services/server/telemetry';

/**
 * Fail fast rather than hanging a request behind an unreachable database.
 * The ledger's open path is on the /api/llm request path, so this timeout is
 * the worst case an inference can pay — once, before the ledger's cooldown
 * takes over (see OPEN_FAILURE_COOLDOWN_MS).
 */
const CONNECT_TIMEOUT_MS = 3_000;
const STATEMENT_TIMEOUT_MS = 5_000;
const MAX_CLIENTS = 5;

export function isDatabaseConfigured(): boolean {
    return Boolean(process.env.DATABASE_URL?.trim());
}

// Next's dev server re-evaluates modules on every edit. A module-local pool
// would leak a connection set per reload, so it is cached on globalThis.
const globalForPg = globalThis as typeof globalThis & { __omniPgPool?: Pool };

function pool(): Pool | null {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) return null;

    if (!globalForPg.__omniPgPool) {
        globalForPg.__omniPgPool = new Pool({
            connectionString,
            max: MAX_CLIENTS,
            connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
            statement_timeout: STATEMENT_TIMEOUT_MS,
            // Ambient SSL for hosted Postgres; local sockets ignore it.
            ssl: /\bsslmode=verify-(full|ca)\b/.test(connectionString)
                ? { rejectUnauthorized: true }
                : /\bsslmode=require\b/.test(connectionString)
                  ? { rejectUnauthorized: false }
                  : undefined
        });
        // An idle-client error must not take the process down with it. Its
        // text can carry the connection string, so only the class is logged.
        globalForPg.__omniPgPool.on('error', err => {
            logEvent('flyspace.db.idle_client_failed', { kind: errorKind(err) });
        });
    }
    return globalForPg.__omniPgPool;
}

/**
 * Run one parameterized statement. `values` are always bound by the driver —
 * nothing in this codebase concatenates a value into SQL.
 *
 * Returns null when no database is configured, so callers branch on absence
 * instead of throwing. Real errors still throw; the ledger swallows them.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: readonly unknown[] = []
): Promise<{ rows: T[] } | null> {
    const p = pool();
    if (!p) return null;
    const result = await p.query<T>(text, values as unknown[]);
    return { rows: result.rows };
}

/**
 * Run several statements on ONE connection inside a transaction. Used where
 * a run and its sources must land together or not at all.
 */
export async function transaction<T>(
    fn: (client: PoolClient) => Promise<T>
): Promise<T | null> {
    const p = pool();
    if (!p) return null;
    const client = await p.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch {
            // The connection is already gone; the transaction died with it.
        }
        throw err;
    } finally {
        client.release();
    }
}

/** Close the pool. For the migration script and integration tests. */
export async function closePool(): Promise<void> {
    if (globalForPg.__omniPgPool) {
        await globalForPg.__omniPgPool.end();
        globalForPg.__omniPgPool = undefined;
    }
}
