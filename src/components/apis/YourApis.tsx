'use client';

import { approveCapability, denyCapability, uninstallCapability } from '@/core/capabilities/registry';
import { useCapabilityStore } from '@/core/capabilities/store';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { EffectPill, MethodBadge, operationParts } from './ApiReview';

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

    return (
        <div className="space-y-4 p-4">
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
