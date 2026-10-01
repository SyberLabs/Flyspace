// Durable record of capability runs. The vault keeps it across a reload, so a
// write that left the process and never closed comes back uncertain instead of
// disappearing. Same key and same input replays. Same key and a different
// input conflicts. Neither path dispatches again.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { vaultStorage } from '../vault';
import { canonicalize, sha256 } from './hash';
import type { CapabilityEffect } from './manifest';

export type ExecutionPhase = 'admitted' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'uncertain';

export interface ExecutionReceipt {
    ok: boolean;
    code?: string;
    message?: string;
    value?: unknown;
}

export type ExecutionProfileKind = 'sync' | 'async_poll';

/** What the destination last reported. `accepted` means start returned a run id. */
export type ObservedStatus = 'accepted' | 'running' | 'succeeded' | 'failed';

export interface ExecutionRecord {
    runId: string;
    capabilityId: string;
    manifestDigest: string;
    effect: CapabilityEffect;
    inputDigest: string;
    idempotencyKey: string;
    startedAt: number;
    deadlineAt: number;
    dispatchedAt?: number;
    finishedAt?: number;
    status: ExecutionPhase;
    receipt?: ExecutionReceipt;
    /** Absent on records written before execution profiles; read as `sync`. */
    executionProfile?: ExecutionProfileKind;
    providerId?: string;
    externalRunId?: string;
    lastObservedStatus?: ObservedStatus;
    lastObservedAt?: number;
    /** Dispatch is never repeated by Omni. Only observation (poll) repeats. */
    retryPolicy?: 'no_redispatch';
}

const MAX_RECORDS = 200;
const RECEIPT_VALUE_LIMIT = 100_000;

interface LedgerState {
    records: ExecutionRecord[];
    createClaims: string[];
}

export const useExecutionLedger = create<LedgerState>()(
    persist(
        (): LedgerState => ({ records: [], createClaims: [] }),
        {
            name: 'omni-capability-executions',
            version: 1,
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({ records: state.records, createClaims: state.createClaims })
        }
    )
);

export function clearExecutionLedger(): void {
    useExecutionLedger.setState({ records: [], createClaims: [] });
}

export function executionRecords(): ExecutionRecord[] {
    return useExecutionLedger.getState().records;
}

export function latestExecutionRecord(capabilityId: string): ExecutionRecord | undefined {
    let latest: ExecutionRecord | undefined;
    for (const record of executionRecords()) {
        if (record.capabilityId !== capabilityId) continue;
        if (!latest || record.startedAt >= latest.startedAt) latest = record;
    }
    return latest;
}

function isSideEffect(effect: CapabilityEffect): boolean {
    return effect === 'write' || effect === 'destructive';
}

/** A run that outlived its deadline without a terminal row is closed here. */
export function reconcileExecutions(now = Date.now()): void {
    let changed = false;
    const records = executionRecords().map(record => {
        if (record.status !== 'admitted' && record.status !== 'running') return record;
        if (now <= record.deadlineAt) return record;
        changed = true;
        if (record.dispatchedAt && isSideEffect(record.effect)) {
            return {
                ...record,
                status: 'uncertain' as const,
                finishedAt: now,
                receipt: {
                    ok: false,
                    code: 'EFFECT_UNCERTAIN',
                    message: 'The call was dispatched and the outcome was not observed. Do not retry automatically.'
                }
            };
        }
        return {
            ...record,
            status: 'failed' as const,
            finishedAt: now,
            receipt: { ok: false, code: 'DEADLINE', message: 'The run ended without a result' }
        };
    });
    if (changed) useExecutionLedger.setState({ records });
}

export type Admission =
    | { kind: 'admit'; record: ExecutionRecord }
    | { kind: 'replay'; record: ExecutionRecord }
    | { kind: 'conflict'; record: ExecutionRecord }
    | { kind: 'in_flight'; record: ExecutionRecord }
    | { kind: 'uncertain'; record: ExecutionRecord };

export function admitExecution(input: {
    capabilityId: string;
    manifestDigest: string;
    effect: CapabilityEffect;
    input: unknown;
    idempotencyKey: string;
    deadlineMs: number;
    now?: number;
    executionProfile?: ExecutionProfileKind;
    providerId?: string;
}): Admission {
    const now = input.now ?? Date.now();
    reconcileExecutions(now);
    const inputDigest = sha256(canonicalize(input.input));
    const existing = executionRecords().find(record =>
        record.capabilityId === input.capabilityId && record.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
        if (existing.inputDigest !== inputDigest) return { kind: 'conflict', record: existing };
        if (existing.status === 'uncertain') return { kind: 'uncertain', record: existing };
        if (existing.status === 'admitted' || existing.status === 'running') return { kind: 'in_flight', record: existing };
        return { kind: 'replay', record: existing };
    }

    const record: ExecutionRecord = {
        runId: `run_${sha256(`${input.manifestDigest}|${input.idempotencyKey}|${now}`).slice(0, 16)}`,
        capabilityId: input.capabilityId,
        manifestDigest: input.manifestDigest,
        effect: input.effect,
        inputDigest,
        idempotencyKey: input.idempotencyKey,
        startedAt: now,
        deadlineAt: now + input.deadlineMs,
        status: 'admitted',
        ...(input.executionProfile === 'async_poll' ? { executionProfile: 'async_poll' as const, retryPolicy: 'no_redispatch' as const } : {}),
        ...(input.providerId ? { providerId: input.providerId } : {})
    };
    useExecutionLedger.setState({ records: trim([...executionRecords(), record]) });
    return { kind: 'admit', record };
}

export function markExecutionDispatched(runId: string, at = Date.now()): void {
    useExecutionLedger.setState({
        records: executionRecords().map(record =>
            record.runId === runId
                ? { ...record, status: 'running', dispatchedAt: record.dispatchedAt ?? at }
                : record
        )
    });
}

export function finishExecution(
    runId: string,
    status: Exclude<ExecutionPhase, 'admitted' | 'running'>,
    receipt: ExecutionReceipt,
    at = Date.now()
): void {
    const stored = boundReceipt(receipt);
    useExecutionLedger.setState({
        records: executionRecords().map(record =>
            record.runId === runId && (record.status === 'admitted' || record.status === 'running')
                ? { ...record, status, finishedAt: at, receipt: stored }
                : record
        )
    });
}

function update(runId: string, change: (record: ExecutionRecord) => ExecutionRecord): void {
    useExecutionLedger.setState({
        records: executionRecords().map(record => (record.runId === runId ? change(record) : record))
    });
}

/** Start returned. The external run id is what reconciliation queries later. */
export function recordExternalRun(runId: string, externalRunId: string, at = Date.now()): void {
    update(runId, record => (record.externalRunId
        ? record
        : { ...record, externalRunId, lastObservedStatus: 'accepted', lastObservedAt: at }));
}

export function observeExecution(runId: string, status: ObservedStatus, at = Date.now()): void {
    update(runId, record => ({ ...record, lastObservedStatus: status, lastObservedAt: at }));
}

/**
 * An uncertain async run may close only on a terminal status the destination
 * reported for its external run id. Nothing else moves it.
 */
export function settleUncertainExecution(
    runId: string,
    observed: 'succeeded' | 'failed',
    receipt: ExecutionReceipt,
    at = Date.now()
): void {
    const stored = boundReceipt(receipt);
    update(runId, record => (record.status === 'uncertain' && record.externalRunId
        ? { ...record, status: observed, finishedAt: at, receipt: stored, lastObservedStatus: observed, lastObservedAt: at }
        : record));
}

/**
 * The destination reported a terminal status for an uncertain run, and the run
 * still cannot close (a side effect whose value was rejected). The status stays
 * uncertain; the receipt records what was observed, so the ledger and a replay
 * under the same key no longer say the outcome was never seen.
 */
export function recordUncertainObservation(runId: string, receipt: ExecutionReceipt): void {
    const stored = boundReceipt(receipt);
    update(runId, record => (record.status === 'uncertain' && record.externalRunId
        ? { ...record, receipt: stored }
        : record));
}

export function executionRecord(runId: string): ExecutionRecord | undefined {
    return executionRecords().find(record => record.runId === runId);
}

/** One on_create firing per block instance. A remount does not claim again. */
export function claimCreateTrigger(instanceId: string): boolean {
    const claims = useExecutionLedger.getState().createClaims;
    if (claims.includes(instanceId)) return false;
    useExecutionLedger.setState({ createClaims: [...claims, instanceId].slice(-500) });
    return true;
}

function boundReceipt(receipt: ExecutionReceipt): ExecutionReceipt {
    if (receipt.value === undefined) return receipt;
    try {
        if (JSON.stringify(receipt.value).length > RECEIPT_VALUE_LIMIT) {
            return { ok: receipt.ok, code: receipt.code, message: receipt.message };
        }
    } catch {
        return { ok: receipt.ok, code: receipt.code, message: receipt.message };
    }
    return receipt;
}

function trim(records: ExecutionRecord[]): ExecutionRecord[] {
    if (records.length <= MAX_RECORDS) return records;
    const pinned = records.filter(record =>
        record.status === 'uncertain' || record.status === 'running' || record.status === 'admitted'
    );
    const rest = records.filter(record => !pinned.includes(record));
    const room = Math.max(0, MAX_RECORDS - pinned.length);
    return [...rest.slice(-room), ...pinned];
}
