'use client';

import { useEffect, useRef, useState } from 'react';
import { useBlockStore, useWireStore } from '@/core/stores';
import { previewInstalledRun, runInstalledCapability } from '@/core/capabilities/registry';
import type { RunPreview } from '@/core/capabilities/execute';
import { useCapabilityStore } from '@/core/capabilities/store';
import { claimCreateTrigger, latestExecutionRecord, useExecutionLedger } from '@/core/capabilities/executionLedger';
import { canonicalize, sha256 } from '@/core/capabilities/hash';
import { newId } from '@/core/id';
import { triggerIdempotencyKey } from '@/core/capabilities/triggers';
import { resolveWiredInputs } from '@/core/capabilities/wireInputs';
import type { OmniItem } from '@/core/gateway';
import { EffectPill } from '@/components/apis/ApiReview';
import { argumentsFrom, CapabilityInputs, inputSummaryOf, missingInputs } from './CapabilityInputs';
import { CapabilityResult } from './CapabilityResult';

function readItems(data: unknown): OmniItem[] {
    if (!data || typeof data !== 'object' || !('items' in data)) return [];
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is OmniItem =>
        !!item && typeof item === 'object' && typeof (item as OmniItem).title === 'string'
    );
}

/** The response itself, as the last run left it on the block. */
function readTypedValue(data: unknown): { present: boolean; value: unknown } {
    if (!data || typeof data !== 'object' || !('typed' in data)) return { present: false, value: undefined };
    const typed = (data as { typed?: { value?: unknown } | null }).typed;
    return typed && 'value' in typed ? { present: true, value: typed.value } : { present: false, value: undefined };
}

function isPlainParams(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One view for every runtime capability.
 * Mounting the view is not an execution request. The user runs it.
 * Write and destructive also wait until approval, and every write or
 * destructive run shows its method, resolved URL and arguments first: it is
 * sent only after the person confirms that exact request.
 */
/** What an HTTP status usually means for the person running the block. */
export function errorHint(error: string): string | null {
    const status = /\bHTTP (\d{3})\b/.exec(error)?.[1];
    if (status === '401' || status === '403') return 'The API refused the request. Check the key, or whether your plan covers this call.';
    if (status === '404') return 'Nothing was found for these inputs.';
    if (status === '429') return 'Too many requests. Wait a moment, then run again.';
    if (status?.startsWith('5')) return 'The API had a problem on its side. Try again later.';
    return null;
}

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
    // Inputs fold away once a run has answered, so the result has the room;
    // an explicit toggle by the person wins until the block remounts.
    const [inputsPinned, setInputsPinned] = useState<boolean | null>(null);

    const sideEffect = manifest?.effect === 'write' || manifest?.effect === 'destructive';
    const params = isPlainParams(block?.params) ? block.params : {};
    // Recomputed with every wire or block change (both are subscribed above).
    const wired = manifest ? resolveWiredInputs(instanceId) : {};
    const missing = manifest ? missingInputs(manifest.inputs, params, wired) : [];
    const trigger = manifest?.trigger ?? { kind: 'manual' as const };

    const run = (idempotencyKey?: string, confirmedRun?: string) => {
        if (!manifest || running) return;
        if (sideEffect && (manifest.approval !== 'approved' || !confirmedRun)) return;
        const key = idempotencyKey ?? attemptKey.current ?? `click_${newId()}`;
        attemptKey.current = key;
        void runInstalledCapability(instanceId, argumentsFrom(manifest.inputs, params), { idempotencyKey: key, confirmedRun }).then(result => {
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
        const preview = previewInstalledRun(instanceId, manifest ? argumentsFrom(manifest.inputs, params) : undefined);
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
    const response = readTypedValue(block?.data);
    const blocked = sideEffect && manifest?.approval !== 'approved';
    const destination = manifest?.transport.kind === 'http' ? new URL(manifest.transport.baseUrl).host : null;
    const answered = response.present || items.length > 0;
    const showInputs = inputsPinned ?? (!answered || !!block?.error || missing.length > 0);
    const inputSummary = manifest ? inputSummaryOf(manifest.inputs, params) : '';

    return (
        <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-sm text-[var(--text-primary)]">
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                {manifest ? <EffectPill effect={manifest.effect} /> : <span>not installed</span>}
                {destination ? <span className="min-w-0 truncate font-mono" title={destination}>{destination}</span> : null}
                {sideEffect ? (
                    <span className="ml-auto shrink-0">{manifest?.approval === 'approved' ? 'approved' : 'needs approval'}</span>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {/* What you look at after Run comes first: the error or the result. */}
                {block?.error ? (
                    <p role="alert" className="rounded-md border border-[var(--truth-red)]/40 px-2 py-1 text-xs text-[var(--truth-red)] [overflow-wrap:anywhere]">
                        {block.error}
                        {errorHint(block.error) ? <span className="block text-[var(--text-muted)]">{errorHint(block.error)}</span> : null}
                    </p>
                ) : null}

                {response.present ? (
                    <CapabilityResult value={response.value} />
                ) : items.length > 0 ? (
                    <ul className="space-y-1">
                        {items.slice(0, 8).map(item => (
                            <li key={item.id} className="text-xs [overflow-wrap:anywhere]">{item.title}</li>
                        ))}
                    </ul>
                ) : null}

                {manifest && manifest.inputs.length > 0 ? (
                    showInputs ? (
                        <div className="space-y-1">
                            {answered ? (
                                <button type="button" onClick={() => setInputsPinned(false)}
                                    className="text-[11px] text-[var(--text-muted)] underline">Hide inputs</button>
                            ) : null}
                            <CapabilityInputs
                                inputs={manifest.inputs}
                                params={params}
                                wired={wired}
                                disabled={running}
                                onChange={(name, draft) => useBlockStore.getState().setParams(instanceId, { [name]: draft })}
                            />
                        </div>
                    ) : (
                        <button type="button" onClick={() => setInputsPinned(true)}
                            className="block w-full truncate text-left text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                            Inputs: {inputSummary}
                        </button>
                    )
                ) : null}

                {!answered && !block?.error && (!manifest || manifest.inputs.length === 0) ? (
                    <p className="text-xs text-[var(--text-muted)]">
                        {manifest ? 'Run it to see the result here.' : 'This capability is not installed.'}
                    </p>
                ) : null}
            </div>
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
                    disabled={!manifest || running || blocked || missing.length > 0}
                    className="shrink-0 rounded-md bg-[var(--citadel-primary)] px-2 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--citadel-elevated)] disabled:text-[var(--text-muted)]"
                >
                    {running
                        ? 'Running…'
                        : blocked
                            ? 'Needs approval'
                            : missing.length > 0
                                ? `Enter ${missing.map(input => input.name).join(', ')}`
                                : 'Run'}
                </button>
            )}
        </div>
    );
}
