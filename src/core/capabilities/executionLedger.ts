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
        status: 'admitted'
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
