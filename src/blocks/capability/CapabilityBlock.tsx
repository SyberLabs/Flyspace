'use client';

import { useEffect, useRef, useState } from 'react';
import { useBlockStore, useWireStore } from '@/core/stores';
import { previewInstalledRun, runInstalledCapability } from '@/core/capabilities/registry';
import type { RunPreview } from '@/core/capabilities/execute';
import { useCapabilityStore } from '@/core/capabilities/store';
import { claimCreateTrigger, latestExecutionRecord, useExecutionLedger } from '@/core/capabilities/executionLedger';
import { canonicalize, sha256 } from '@/core/capabilities/hash';
import { triggerIdempotencyKey } from '@/core/capabilities/triggers';
import { resolveWiredInputs } from '@/core/capabilities/wireInputs';
import type { OmniItem } from '@/core/gateway';

function readItems(data: unknown): OmniItem[] {
    if (!data || typeof data !== 'object' || !('items' in data)) return [];
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is OmniItem =>
        !!item && typeof item === 'object' && typeof (item as OmniItem).title === 'string'
    );
}

function readTypedKind(data: unknown): string | null {
    if (!data || typeof data !== 'object' || !('typed' in data)) return null;
    const typed = (data as { typed?: { schema?: { kind?: string } } | null }).typed;
    return typed?.schema?.kind ?? null;
}

/**
 * One view for every runtime capability.
 * Mounting the view is not an execution request. The user runs it.
 * Write and destructive also wait until approval, and every write or
 * destructive run shows its method, resolved URL and arguments first: it is
 * sent only after the person confirms that exact request.
 */
export function CapabilityBlockView({ instanceId }: { instanceId: string }) {
    const block = useBlockStore(state => state.getBlock(instanceId));
    const capabilityId = block?.schema.capabilityId ?? '';
    const manifest = useCapabilityStore(state => state.manifests.find(entry => entry.id === capabilityId));
    const latest = useExecutionLedger(state => state.records.find(record => record.capabilityId === capabilityId && record.startedAt === latestExecutionRecord(capabilityId)?.startedAt));
    const running = latest?.status === 'admitted' || latest?.status === 'running';
    const attemptKey = useRef<string | null>(null);
    const seenInput = useRef<string | undefined>(undefined);
    const wires = useWireStore(state => state.wires);
    const blocks = useBlockStore(state => state.blocks);
    const [pendingRun, setPendingRun] = useState<RunPreview | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const sideEffect = manifest?.effect === 'write' || manifest?.effect === 'destructive';
    const trigger = manifest?.trigger ?? { kind: 'manual' as const };

    const run = (idempotencyKey?: string, confirmedRun?: string) => {
        if (!manifest || running) return;
        if (sideEffect && (manifest.approval !== 'approved' || !confirmedRun)) return;
        const key = idempotencyKey ?? attemptKey.current ?? `click_${sha256(`${instanceId}|${Date.now()}|${Math.random()}`).slice(0, 24)}`;
        attemptKey.current = key;
        void runInstalledCapability(instanceId, undefined, { idempotencyKey: key, confirmedRun }).then(result => {
            if (result.error?.code !== 'EFFECT_UNCERTAIN') attemptKey.current = null;
        });
    };

    /** A read runs now. A write or destructive run shows what it will send and waits. */
    const requestRun = () => {
        setPreviewError(null);
        if (!sideEffect) {
            run();
            return;
        }
        const preview = previewInstalledRun(instanceId);
        if (preview.ok) setPendingRun(preview.preview);
        else setPreviewError(preview.result.error?.message ?? 'This run cannot be prepared');
    };

    const confirmRun = () => {
        if (!pendingRun) return;
        const digest = pendingRun.digest;
        setPendingRun(null);
        run(undefined, digest);
    };
    const runRef = useRef(run);
    useEffect(() => {
        runRef.current = run;
    });
    const triggerKind = trigger.kind;
    const everyMs = trigger.kind === 'interval' ? trigger.everyMs : 0;

    useEffect(() => {
        if (!manifest || sideEffect || triggerKind === 'manual' || triggerKind === 'on_input_change') return;
        if (triggerKind === 'on_create') {
            if (!claimCreateTrigger(instanceId)) return;
            runRef.current(triggerIdempotencyKey('on_create', instanceId, 'once'));
            return;
        }
        const timer = window.setInterval(() => {
            const slot = String(Math.floor(Date.now() / everyMs));
            runRef.current(triggerIdempotencyKey('interval', instanceId, slot));
        }, everyMs);
        return () => window.clearInterval(timer);
    }, [instanceId, manifest, sideEffect, triggerKind, everyMs]);

    useEffect(() => {
        if (!manifest || sideEffect || triggerKind !== 'on_input_change') return;
        const digest = sha256(canonicalize(resolveWiredInputs(instanceId)));
        if (seenInput.current === undefined) {
            seenInput.current = digest;
            return;
        }
        if (seenInput.current === digest) return;
        seenInput.current = digest;
        const timer = window.setTimeout(() => {
            runRef.current(triggerIdempotencyKey('on_input_change', instanceId, digest.slice(0, 24)));
        }, 300);
        return () => window.clearTimeout(timer);
    }, [instanceId, manifest, sideEffect, triggerKind, wires, blocks]);

    const items = readItems(block?.data);
    const typedKind = readTypedKind(block?.data);
    const blocked = sideEffect && manifest?.approval !== 'approved';

    return (
        <div className="flex h-full flex-col gap-2 p-3 text-sm text-[var(--text-primary)]">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span>{manifest?.effect ?? 'missing'} · {manifest?.approval ?? 'uninstalled'}</span>
                {typedKind ? <span>typed {typedKind}</span> : null}
            </div>
            {block?.error ? (
                <p className="text-xs text-[var(--truth-red)]">{block.error}</p>
            ) : null}
            {items.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                    {manifest ? 'No result yet.' : 'This capability is not installed.'}
                </p>
            ) : (
                <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
                    {items.slice(0, 8).map(item => (
                        <li key={item.id} className="truncate">{item.title}</li>
                    ))}
                </ul>
            )}
            {previewError ? (
                <p className="text-xs text-[var(--truth-red)]">{previewError}</p>
            ) : null}
            {pendingRun ? (
                <div role="group" aria-label="Confirm request" className="space-y-1 rounded border border-[var(--citadel-border)] p-2 text-xs">
                    <p>Send this {pendingRun.effect} request?</p>
                    <p className="break-all font-mono">
                        <span data-testid="confirm-method">{pendingRun.method}</span>{' '}
                        <span data-testid="confirm-url">{pendingRun.url}</span>
                    </p>
                    {pendingRun.credential ? (
                        <p className="text-[var(--text-muted)]">Credential: {pendingRun.credential}</p>
                    ) : null}
                    <pre data-testid="confirm-arguments" className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono">
                        {JSON.stringify(pendingRun.arguments, null, 2)}
                    </pre>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={confirmRun}
                            className="rounded border border-[var(--citadel-border)] px-2 py-1"
                        >
                            Send
                        </button>
                        <button
                            type="button"
                            onClick={() => setPendingRun(null)}
                            className="rounded border border-[var(--citadel-border)] px-2 py-1"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={requestRun}
                    disabled={!manifest || running || blocked}
                    className="rounded border border-[var(--citadel-border)] px-2 py-1 text-xs disabled:opacity-50"
                >
                    {running ? 'Running…' : blocked ? 'Needs approval' : 'Run'}
                </button>
            )}
        </div>
    );
}
