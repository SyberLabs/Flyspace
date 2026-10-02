// Server-side capability executions. Postgres when a database is configured,
// otherwise an in-process map. The browser vault is still the record the
// person at the keyboard reloads. This one is the record of what the broker
// itself dispatched.

import { query, isDatabaseConfigured } from '@/core/db/client';

export type ServerPhase = 'admitted' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'uncertain';
export type ServerExecutionProfile = 'sync' | 'async_poll';
export type ServerObservedStatus = 'accepted' | 'running' | 'succeeded' | 'failed';

export interface ServerExecution {
    runId: string;
    capabilityId: string;
    manifestDigest: string;
    effect: string;
    inputDigest: string;
    idempotencyKey: string;
    status: ServerPhase;
    dispatchedAt?: number;
    error?: string;
    /** Absent means `sync`, which is every row written before migration 005. */
    executionProfile?: ServerExecutionProfile;
    providerId?: string;
    externalRunId?: string;
    lastObservedStatus?: ServerObservedStatus;
    lastObservedAt?: number;
}

export interface ServerAdmit {
    kind: 'new' | 'replay' | 'conflict' | 'in_flight' | 'uncertain';
    row: ServerExecution;
}

export interface ServerLedger {
    admit(row: ServerExecution): Promise<ServerAdmit>;
    markDispatched(runId: string): Promise<void>;
    /** Set once. A second id for the same run is ignored, never swapped in. */
    recordExternalRun(runId: string, externalRunId: string): Promise<void>;
    observe(runId: string, status: ServerObservedStatus): Promise<void>;
    finish(runId: string, status: Exclude<ServerPhase, 'admitted' | 'running'>, error?: string): Promise<void>;
    find(runId: string): Promise<ServerExecution | undefined>;
}

/** The no-database ledger keeps this many rows; settled rows are evicted first, oldest first. */
export const MEMORY_LEDGER_MAX_ROWS = 1_000;

export function memoryLedger(maxRows = MEMORY_LEDGER_MAX_ROWS): ServerLedger {
    const rows = new Map<string, ServerExecution>();
    const evict = () => {
        while (rows.size >= maxRows) {
            let victim: string | undefined;
            for (const [entryKey, row] of rows) {
                if (row.status !== 'admitted' && row.status !== 'running') {
                    victim = entryKey;
                    break;
                }
            }
            rows.delete(victim ?? rows.keys().next().value!);
        }
    };
    const key = (row: Pick<ServerExecution, 'capabilityId' | 'idempotencyKey'>) =>
        `${row.capabilityId}\n${row.idempotencyKey}`;
    const byRun = (runId: string) => [...rows.values()].find(row => row.runId === runId);

    return {
        async admit(row) {
            const existing = rows.get(key(row));
            if (existing) return { kind: kindFor(existing, row.inputDigest), row: { ...existing } };
            const stored: ServerExecution = { ...row, executionProfile: row.executionProfile ?? 'sync' };
            evict();
            rows.set(key(row), stored);
            return { kind: 'new', row: { ...stored } };
        },
        async markDispatched(runId) {
            const row = byRun(runId);
            if (row && row.status === 'admitted') {
                row.status = 'running';
                row.dispatchedAt = Date.now();
            }
        },
        async recordExternalRun(runId, externalRunId) {
            const row = byRun(runId);
            if (!row || row.executionProfile !== 'async_poll' || row.externalRunId) return;
            row.externalRunId = externalRunId;
            row.lastObservedStatus = 'accepted';
            row.lastObservedAt = Date.now();
        },
        async observe(runId, status) {
            const row = byRun(runId);
            if (!row || row.executionProfile !== 'async_poll') return;
            row.lastObservedStatus = status;
            row.lastObservedAt = Date.now();
        },
        async finish(runId, status, error) {
            const row = byRun(runId);
            if (!row || (row.status !== 'admitted' && row.status !== 'running')) return;
            row.status = status;
            row.error = error;
        },
        async find(runId) {
            const row = byRun(runId);
            return row ? { ...row } : undefined;
        }
    };
}

function kindFor(existing: ServerExecution, inputDigest: string): ServerAdmit['kind'] {
    if (existing.inputDigest !== inputDigest) return 'conflict';
    if (existing.status === 'uncertain') return 'uncertain';
    if (existing.status === 'admitted' || existing.status === 'running') return 'in_flight';
    return 'replay';
}

const INSERT = `
    INSERT INTO capability_execution (
        id, capability_id, manifest_digest, effect, input_digest, idempotency_key, status,
        provider_id, execution_profile
    ) VALUES ($1, $2, $3, $4, $5, $6, 'admitted', $7, $8)
    ON CONFLICT (capability_id, idempotency_key) DO NOTHING
    RETURNING id
`;

const COLUMNS = `
    id, capability_id, manifest_digest, effect, input_digest, idempotency_key, status, error,
    provider_id, execution_profile, external_run_id, last_observed_status,
    (extract(epoch from dispatched_at) * 1000)::bigint AS dispatched_ms,
    (extract(epoch from last_observed_at) * 1000)::bigint AS observed_ms
`;

const FIND = `SELECT ${COLUMNS} FROM capability_execution WHERE capability_id = $1 AND idempotency_key = $2`;
const FIND_RUN = `SELECT ${COLUMNS} FROM capability_execution WHERE id = $1`;

interface Row {
    id: string;
    capability_id: string;
    manifest_digest: string;
    effect: string;
    input_digest: string;
    idempotency_key: string;
    status: ServerPhase;
    error: string | null;
    provider_id: string | null;
    execution_profile: ServerExecutionProfile | null;
    external_run_id: string | null;
    last_observed_status: ServerObservedStatus | null;
    dispatched_ms: string | number | null;
    observed_ms: string | number | null;
}

function fromRow(found: Row): ServerExecution {
    return {
        runId: found.id,
        capabilityId: found.capability_id,
        manifestDigest: found.manifest_digest,
        effect: found.effect,
        inputDigest: found.input_digest,
        idempotencyKey: found.idempotency_key,
        status: found.status,
        ...(found.error ? { error: found.error } : {}),
        executionProfile: found.execution_profile ?? 'sync',
        ...(found.provider_id ? { providerId: found.provider_id } : {}),
        ...(found.external_run_id ? { externalRunId: found.external_run_id } : {}),
        ...(found.last_observed_status ? { lastObservedStatus: found.last_observed_status } : {}),
        ...(found.dispatched_ms !== null ? { dispatchedAt: Number(found.dispatched_ms) } : {}),
        ...(found.observed_ms !== null ? { lastObservedAt: Number(found.observed_ms) } : {})
    };
}

export function postgresLedger(): ServerLedger {
    return {
        async admit(row) {
            const inserted = await query<{ id: string }>(INSERT, [
                row.runId, row.capabilityId, row.manifestDigest, row.effect, row.inputDigest, row.idempotencyKey,
                row.providerId ?? null, row.executionProfile ?? 'sync'
            ]);
            if (inserted && inserted.rows[0]) return { kind: 'new', row: { ...row, executionProfile: row.executionProfile ?? 'sync' } };
            const existing = await query<Row>(FIND, [row.capabilityId, row.idempotencyKey]);
            const found = existing?.rows[0];
            if (!found) throw new Error('Capability execution conflict could not be resolved');
            const stored = fromRow(found);
            return { kind: kindFor(stored, row.inputDigest), row: stored };
        },
        async markDispatched(runId) {
            await query(
                `UPDATE capability_execution
                    SET status = 'running', dispatched_at = now()
                  WHERE id = $1 AND status = 'admitted'`,
                [runId]
            );
        },
        async recordExternalRun(runId, externalRunId) {
            await query(
                `UPDATE capability_execution
                    SET external_run_id = $2, last_observed_status = 'accepted', last_observed_at = now()
                  WHERE id = $1 AND execution_profile = 'async_poll' AND external_run_id IS NULL`,
                [runId, externalRunId]
            );
        },
        async observe(runId, status) {
            await query(
                `UPDATE capability_execution
                    SET last_observed_status = $2, last_observed_at = now()
                  WHERE id = $1 AND execution_profile = 'async_poll'`,
                [runId, status]
            );
        },
        async finish(runId, status, error) {
            await query(
                `UPDATE capability_execution
                    SET status = $2, finished_at = now(), error = $3
                  WHERE id = $1 AND status IN ('admitted', 'running')`,
                [runId, status, error ?? null]
            );
        },
        async find(runId) {
            const result = await query<Row>(FIND_RUN, [runId]);
            const found = result?.rows[0];
            return found ? fromRow(found) : undefined;
        }
    };
}

export function openServerLedger(): ServerLedger {
    return isDatabaseConfigured() ? postgresLedger() : memoryLedger();
}
