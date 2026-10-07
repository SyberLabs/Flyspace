'use client';

import { useState } from 'react';
import { capabilitySecrets } from '@/core/capabilities/secrets';
import { approveCapability, denyCapability, uninstallCapability } from '@/core/capabilities/registry';
import { useCapabilityStore } from '@/core/capabilities/store';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { EffectPill, MethodBadge, destinationOf, operationParts } from './ApiReview';
import { KeyField, keySlotOf, useHasKey } from './KeyField';

/**
 * One row per key slot. Operations of one API share a slot, so the key is
 * entered once for all of them.
 */
function KeyRow({ manifest, count }: { manifest: CapabilityManifest; count: number }) {
    const ref = keySlotOf(manifest)!;
    const hasKey = useHasKey(ref);
    const [editing, setEditing] = useState(false);
    const destination = destinationOf(manifest);
    return (
        <li className="space-y-1.5 rounded-lg border border-[var(--citadel-border)] px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-mono text-[var(--text-secondary)] [overflow-wrap:anywhere]">{destination?.origin}</span>
                <span className={hasKey ? 'text-[var(--truth-green)]' : 'text-[var(--truth-amber)]'}>
                    {hasKey ? 'Entered for this session' : 'Not entered this session'}
                </span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)]">
                {destination?.credential} · used by {count} operation{count === 1 ? '' : 's'}
            </p>
            {editing ? (
                <KeyField manifest={manifest} autoFocus onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
            ) : (
                <div className="flex gap-2">
                    <button type="button" onClick={() => setEditing(true)}
                        aria-label={`${hasKey ? 'Change' : 'Enter'} key for ${destination?.origin ?? ref}`}
                        className="rounded border border-[var(--citadel-border)] px-2 py-0.5 hover:bg-[var(--citadel-elevated)]">
                        {hasKey ? 'Change key' : 'Enter key'}
                    </button>
                    {hasKey ? (
                        <button type="button" onClick={() => capabilitySecrets.revoke(ref)}
                            aria-label={`Forget key for ${destination?.origin ?? ref}`}
                            className="rounded px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--truth-red)]">
                            Forget key
                        </button>
                    ) : null}
                </div>
            )}
        </li>
    );
}

/** APIs a person installed, as opposed to the built-in speech handlers. */
export function isUserInstalled(manifest: CapabilityManifest): boolean {
    return manifest.source.locator !== 'speech';
}

export interface YourApisProps {
    /** Put an installed operation on the canvas again. */
    onPlace: (manifest: CapabilityManifest) => void;
}

/**
 * Everything installed, with what it needs from you. A write or destructive
 * operation stays unrunnable until approved here; approval is never implied
 * by installing. Entries the current rules could not restore are listed by
 * name with the reason, not silently dropped.
 */
export function YourApis({ onPlace }: YourApisProps) {
    const installed = useCapabilityStore(state => state.manifests).filter(isUserInstalled);
    const stale = useCapabilityStore(state => state.stale);
    const forgetStale = useCapabilityStore(state => state.forgetStale);

    if (installed.length === 0 && stale.length === 0) {
        return <p className="p-4 text-sm text-[var(--text-muted)]">No APIs installed yet. Find one to get started.</p>;
    }

    // The first operation stands for its slot; the rest share the key.
    const slots = new Map<string, { manifest: CapabilityManifest; count: number }>();
    for (const manifest of installed) {
        const ref = keySlotOf(manifest);
        if (!ref) continue;
        const entry = slots.get(ref);
        if (entry) entry.count += 1;
        else slots.set(ref, { manifest, count: 1 });
    }

    return (
        <div className="space-y-4 p-4">
            {slots.size > 0 ? (
                <section aria-label="Keys" className="space-y-1.5">
                    <h4 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Keys</h4>
                    <p className="text-[10px] text-[var(--text-muted)]">Kept for this session only, never saved with your canvas. Enter them again after a reload.</p>
                    <ul className="space-y-1.5">
                        {[...slots].map(([ref, entry]) => <KeyRow key={ref} manifest={entry.manifest} count={entry.count} />)}
                    </ul>
                </section>
            ) : null}

            {installed.length > 0 ? (
                <ul aria-label="Installed APIs" className="space-y-1.5">
                    {installed.map(manifest => {
                        const parts = operationParts(manifest);
                        const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
                        return (
                            <li key={manifest.id} className="rounded-lg border border-[var(--citadel-border)] px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                    <span className="text-sm text-[var(--text-primary)] [overflow-wrap:anywhere]">{manifest.title}</span>
                                    <EffectPill effect={manifest.effect} />
                                </div>
                                {parts ? (
                                    <div className="mt-1 flex items-start gap-1.5">
                                        <MethodBadge method={parts.method} />
                                        <code className="text-[11px] text-[var(--text-muted)] [overflow-wrap:anywhere]">{parts.path}</code>
                                    </div>
                                ) : null}
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                                    {sideEffect ? (
                                        <span className="text-[var(--text-muted)]">
                                            {manifest.approval === 'approved' ? 'Approved' : manifest.approval === 'denied' ? 'Denied' : 'Waiting for approval'}
                                        </span>
                                    ) : null}
                                    {sideEffect && manifest.approval !== 'approved' ? (
                                        <button type="button" onClick={() => approveCapability(manifest.id)}
                                            aria-label={`Approve ${manifest.title}`}
                                            className="rounded border border-[var(--citadel-border)] px-2 py-0.5 hover:bg-[var(--citadel-elevated)]">
                                            Approve
                                        </button>
                                    ) : null}
                                    {sideEffect && manifest.approval !== 'denied' ? (
                                        <button type="button" onClick={() => denyCapability(manifest.id)}
                                            aria-label={`Deny ${manifest.title}`}
                                            className="rounded border border-[var(--citadel-border)] px-2 py-0.5 hover:bg-[var(--citadel-elevated)]">
                                            Deny
                                        </button>
                                    ) : null}
                                    <button type="button" onClick={() => onPlace(manifest)}
                                        aria-label={`Place ${manifest.title} on the canvas`}
                                        className="rounded border border-[var(--citadel-border)] px-2 py-0.5 hover:bg-[var(--citadel-elevated)]">
                                        Place on canvas
                                    </button>
                                    <button type="button" onClick={() => uninstallCapability(manifest.id)}
                                        aria-label={`Remove ${manifest.title}`}
                                        className="ml-auto rounded px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--truth-red)]">
                                        Remove
                                    </button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            ) : null}

            {stale.length > 0 ? (
                <section aria-label="Needs reinstalling" className="space-y-1.5">
                    <h4 className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Needs reinstalling</h4>
                    {stale.map(entry => (
                        <div key={entry.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--truth-red)]/40 px-3 py-2 text-xs">
                            <div className="min-w-0">
                                <p className="text-[var(--text-primary)] [overflow-wrap:anywhere]">{entry.title}</p>
                                <p className="text-[var(--text-muted)]">{entry.reason}</p>
                            </div>
                            <button type="button" onClick={() => forgetStale(entry.id)}
                                aria-label={`Forget ${entry.title}`}
                                className="shrink-0 rounded px-2 py-0.5 text-[var(--text-muted)] hover:text-[var(--truth-red)]">
                                Forget
                            </button>
                        </div>
                    ))}
                </section>
            ) : null}
        </div>
    );
}
