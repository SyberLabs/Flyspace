'use client';

import { credentialPlacement } from '@/core/capabilities/execute';
import type { CapabilityEffect, CapabilityManifest } from '@/core/capabilities/manifest';

export const EFFECT_STYLE: Record<CapabilityEffect, { label: string; className: string }> = {
    read: { label: 'read', className: 'text-[var(--truth-green)] border-[var(--truth-green)]/40' },
    compute: { label: 'compute', className: 'text-[var(--truth-green)] border-[var(--truth-green)]/40' },
    write: { label: 'write · needs approval', className: 'text-[var(--truth-amber)] border-[var(--truth-amber)]/40' },
    destructive: { label: 'destructive · needs approval', className: 'text-[var(--truth-red)] border-[var(--truth-red)]/40' }
};

export function EffectPill({ effect }: { effect: CapabilityEffect }) {
    const style = EFFECT_STYLE[effect];
    return (
        <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[10px] font-medium ${style.className}`}>
            {style.label}
        </span>
    );
}

export function MethodBadge({ method }: { method: string }) {
    return (
        <span className="inline-flex w-12 shrink-0 justify-center rounded bg-[var(--citadel-elevated)] px-1 py-px font-mono text-[10px] font-semibold text-[var(--text-secondary)]">
            {method}
        </span>
    );
}

/** `GET /timeline/{location}` → the parts a row shows. */
export function operationParts(manifest: CapabilityManifest): { method: string; path: string } | null {
    return manifest.transport.kind === 'http' ? { method: manifest.transport.method, path: manifest.transport.path } : null;
}

/** `city, state (optional: units)`: what you will be asked for before a run. */
export function inputSummary(manifest: CapabilityManifest): string {
    const required = manifest.inputs.filter(input => input.required).map(input => input.name);
    const optional = manifest.inputs.filter(input => !input.required).map(input => input.name);
    const shown = (names: string[]) => names.length > 4 ? `${names.slice(0, 4).join(', ')} +${names.length - 4}` : names.join(', ');
    if (required.length === 0) return `optional ${shown(optional)}`;
    return optional.length > 0 ? `${shown(required)} (optional: ${shown(optional)})` : shown(required);
}

/** The origin a request goes to, and how a credential travels with it. */
export function destinationOf(manifest: CapabilityManifest): { origin: string; credential: string | null; inUrl: boolean } | null {
    if (manifest.transport.kind !== 'http') return null;
    const placement = credentialPlacement(manifest);
    return {
        origin: new URL(manifest.transport.baseUrl).origin,
        credential: placement ? `${manifest.auth.kind} in ${placement}` : null,
        inUrl: manifest.auth.in === 'query'
    };
}

export interface ApiReviewProps {
    title: string;
    /** `spec updated 2023-03-06` or a paste note. */
    subtitle: string;
    proposals: CapabilityManifest[];
    install: Record<string, boolean>;
    placeId: string | null;
    onToggleInstall: (id: string, value: boolean) => void;
    onPlace: (id: string) => void;
}

/**
 * What an API will do, laid out as rows: method, path, effect, and the place
 * every request (and credential) goes. One operation is marked to land on
 * the canvas; the rest install into the Armory.
 */
export function ApiReview({ title, subtitle, proposals, install, placeId, onToggleInstall, onPlace }: ApiReviewProps) {
    const destinations = [...new Set(proposals.map(p => destinationOf(p)?.origin).filter(Boolean))];
    return (
        <div className="space-y-3">
            <header className="space-y-0.5">
                <h3 className="text-base font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{title}</h3>
                <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
                {destinations.length > 0 ? (
                    <p className="text-xs text-[var(--text-secondary)]">
                        Sends requests to <span className="font-mono">{destinations.join(', ')}</span>
                    </p>
                ) : null}
            </header>

            <fieldset className="space-y-1">
                <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                    Operations · {proposals.length}
                </legend>
                {proposals.map(manifest => {
                    const parts = operationParts(manifest);
                    const destination = destinationOf(manifest);
                    const checked = install[manifest.id] ?? false;
                    const placed = placeId === manifest.id;
                    return (
                        <div
                            key={manifest.id}
                            className={`rounded-lg border px-2.5 py-2 ${placed ? 'border-[var(--citadel-primary)]' : 'border-[var(--citadel-border)]'}`}
                        >
                            <div className="flex items-start gap-2">
                                <input
                                    type="checkbox"
                                    className="mt-0.5"
                                    aria-label={`Install ${manifest.title}`}
                                    checked={checked}
                                    onChange={event => onToggleInstall(manifest.id, event.target.checked)}
                                />
                                <div className="min-w-0 flex-1 space-y-1">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="text-sm text-[var(--text-primary)] [overflow-wrap:anywhere]">{manifest.title}</span>
                                        <EffectPill effect={manifest.effect} />
                                    </div>
                                    {parts ? (
                                        <div className="flex items-start gap-1.5">
                                            <MethodBadge method={parts.method} />
                                            <code className="text-[11px] text-[var(--text-muted)] [overflow-wrap:anywhere]">{parts.path}</code>
                                        </div>
                                    ) : null}
                                    {manifest.inputs.length > 0 ? (
                                        <p className="text-[11px] text-[var(--text-muted)] [overflow-wrap:anywhere]">
                                            Takes {inputSummary(manifest)}
                                        </p>
                                    ) : null}
                                    {destination?.credential ? (
                                        <p className="text-[11px] text-[var(--text-muted)]">
                                            Key: {destination.credential}
                                            {destination.inUrl ? <span className="ml-1 text-[var(--truth-red)]">· travels in the URL</span> : null}
                                        </p>
                                    ) : null}
                                </div>
                                <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-[var(--text-muted)]">
                                    <input
                                        type="radio"
                                        name="place-on-canvas"
                                        aria-label={`Place ${manifest.title} on the canvas`}
                                        checked={placed}
                                        disabled={!checked}
                                        onChange={() => onPlace(manifest.id)}
                                    />
                                    canvas
                                </label>
                            </div>
                        </div>
                    );
                })}
            </fieldset>
        </div>
    );
}
