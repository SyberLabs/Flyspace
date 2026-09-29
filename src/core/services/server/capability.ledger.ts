// Server-side capability executions. Postgres when a database is configured,
// otherwise an in-process map. The browser vault is still the record the
// person at the keyboard reloads. This one is the record of what the broker
// itself dispatched.

import { query, isDatabaseConfigured } from '@/core/db/client';

export type ServerPhase = 'admitted' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'uncertain';

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
}

export interface ServerAdmit {
    kind: 'new' | 'replay' | 'conflict' | 'in_flight' | 'uncertain';
    row: ServerExecution;
}

export interface ServerLedger {
    admit(row: ServerExecution): Promise<ServerAdmit>;
    markDispatched(runId: string): Promise<void>;
    finish(runId: string, status: Exclude<ServerPhase, 'admitted' | 'running'>, error?: string): Promise<void>;
}

export function memoryLedger(): ServerLedger {
    const rows = new Map<string, ServerExecution>();
    const key = (row: Pick<ServerExecution, 'capabilityId' | 'idempotencyKey'>) =>
        `${row.capabilityId}\n${row.idempotencyKey}`;

    return {
        async admit(row) {
            const existing = rows.get(key(row));
            if (existing) return { kind: kindFor(existing, row.inputDigest), row: existing };
            rows.set(key(row), { ...row });
            return { kind: 'new', row };
        },
        async markDispatched(runId) {
            for (const row of rows.values()) {
                if (row.runId === runId) {
                    row.status = 'running';
                    row.dispatchedAt = Date.now();
                }
            }
        },
        async finish(runId, status, error) {
            for (const row of rows.values()) {
                if (row.runId !== runId) continue;
                if (row.status !== 'admitted' && row.status !== 'running') return;
                row.status = status;
                row.error = error;
            }
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
        id, capability_id, manifest_digest, effect, input_digest, idempotency_key, status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'admitted')
    ON CONFLICT (capability_id, idempotency_key) DO NOTHING
    RETURNING id
`;

const FIND = `
    SELECT id, capability_id, manifest_digest, effect, input_digest, idempotency_key, status, error
      FROM capability_execution
     WHERE capability_id = $1 AND idempotency_key = $2
`;

export function postgresLedger(): ServerLedger {
    return {
        async admit(row) {
            const inserted = await query<{ id: string }>(INSERT, [
                row.runId, row.capabilityId, row.manifestDigest, row.effect, row.inputDigest, row.idempotencyKey
            ]);
            if (inserted && inserted.rows[0]) return { kind: 'new', row };
            const existing = await query<{
                id: string;
                capability_id: string;
                manifest_digest: string;
                effect: string;
                input_digest: string;
                idempotency_key: string;
                status: ServerPhase;
                error: string | null;
            }>(FIND, [row.capabilityId, row.idempotencyKey]);
            const found = existing?.rows[0];
            if (!found) throw new Error('Capability execution conflict could not be resolved');
            const stored: ServerExecution = {
                runId: found.id,
                capabilityId: found.capability_id,
                manifestDigest: found.manifest_digest,
                effect: found.effect,
                inputDigest: found.input_digest,
                idempotencyKey: found.idempotency_key,
                status: found.status,
                ...(found.error ? { error: found.error } : {})
            };
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
        async finish(runId, status, error) {
            await query(
                `UPDATE capability_execution
                    SET status = $2, finished_at = now(), error = $3
                  WHERE id = $1 AND status IN ('admitted', 'running')`,
                [runId, status, error ?? null]
            );
        }
    };
}

export function openServerLedger(): ServerLedger {
    return isDatabaseConfigured() ? postgresLedger() : memoryLedger();
}
