'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ApiSearch } from '@/components/ApiSearch';
import type { ApiIndexEntry } from '@/core/capabilities/apiIndex';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { curatedApi } from '@/core/capabilities/curatedApis';
import { fetchCatalogSpec, RegistryFetchError } from '@/core/capabilities/registrySearch';
import { MAX_SECRET_BYTES, capabilitySecrets, secretByteLength } from '@/core/capabilities/secrets';
import { installProposal } from '@/core/capabilities/registry';
import { useCapabilityStore } from '@/core/capabilities/store';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { spatialSession } from '@/core/interaction/session';
import { useUIStore } from '@/core/stores/uiStore';
import { ApiReview, destinationOf } from './ApiReview';
import { isUserInstalled, YourApis } from './YourApis';

/** A capability block's default footprint, used to center it on the canvas. */
const BLOCK_SIZE = { width: 320, height: 240 };

/**
 * The middle of the visible canvas, nudged per placement so a second API
 * does not land exactly on the first. The canvas has no pan or zoom, so the
 * visible box is the `main` element.
 */
function canvasCenter(nudge: number): { x: number; y: number } {
    const main = typeof document === 'undefined' ? null : document.querySelector('main');
    const rect = main?.getBoundingClientRect();
    const width = rect?.width || 960;
    const height = rect?.height || 640;
    const step = (nudge % 6) * 28;
    return {
        x: Math.max(16, Math.round(width / 2 - BLOCK_SIZE.width / 2 + step)),
        y: Math.max(16, Math.round(height / 2 - BLOCK_SIZE.height / 2 + step))
    };
}

/** The operation to put on the canvas by default: the first read, else the first. */
function defaultPlacement(proposals: CapabilityManifest[]): string | null {
    return (proposals.find(p => p.effect === 'read' || p.effect === 'compute') ?? proposals[0])?.id ?? null;
}

type Review =
    | { state: 'empty' }
    | { state: 'loading'; title: string }
    | { state: 'failed'; message: string }
    | { state: 'ready'; title: string; subtitle: string; proposals: CapabilityManifest[]; issues: string[] };

export interface AddApiDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Add an API: find it (or paste its spec), review exactly what it will do
 * and where it sends requests, then install it and put it on the canvas.
 *
 * The only product door into installProposal. Installing grants nothing:
 * write and destructive operations land pending and need approval under
 * Your APIs. Placing goes through the interaction engine, so it is a traced,
 * undoable command like any other canvas change.
 */
export function AddApiDialog({ open, onClose }: AddApiDialogProps) {
    const [tab, setTab] = useState<'find' | 'yours'>('find');
    const [source, setSource] = useState<'search' | 'paste'>('search');
    const [selected, setSelected] = useState<ApiIndexEntry | null>(null);
    const [review, setReview] = useState<Review>({ state: 'empty' });
    const [install, setInstall] = useState<Record<string, boolean>>({});
    const [placeId, setPlaceId] = useState<string | null>(null);
    const [secrets, setSecrets] = useState<Record<string, string>>({});
    const [errors, setErrors] = useState<string[]>([]);
    const [specText, setSpecText] = useState('');
    const fetchAbort = useRef<AbortController | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const returnFocus = useRef<HTMLElement | null>(null);
    const placements = useRef(0);
    const installedCount = useCapabilityStore(state => state.manifests.filter(isUserInstalled).length);

    // Focus: remember what opened the dialog, give it back on close.
    useEffect(() => {
        if (!open) return;
        returnFocus.current = document.activeElement as HTMLElement | null;
        return () => returnFocus.current?.focus?.();
    }, [open]);

    useEffect(() => () => fetchAbort.current?.abort(), []);

    const proposals = useMemo(() => (review.state === 'ready' ? review.proposals : []), [review]);

    // One credential slot per origin + scheme + placement: the first selected
    // operation that names a slot describes where its value will go.
    const secretSlots = useMemo(() => {
        const slots = new Map<string, CapabilityManifest>();
        for (const manifest of proposals) {
            if (!install[manifest.id]) continue;
            const ref = manifest.auth.secretRef;
            if (ref && !slots.has(ref)) slots.set(ref, manifest);
        }
        return slots;
    }, [proposals, install]);

    if (!open) return null;

    const showProposals = (document: unknown, title: string, subtitle: string, locator?: string, brokerOrigins?: readonly string[]) => {
        const result = compileOpenApi(document, { ...(locator ? { sourceLocator: locator } : {}), ...(brokerOrigins ? { brokerOrigins } : {}) });
        setInstall(Object.fromEntries(result.manifests.map(m => [m.id, true])));
        setPlaceId(defaultPlacement(result.manifests));
        setSecrets({});
        setErrors([]);
        setReview({
            state: 'ready',
            title,
            subtitle,
            proposals: result.manifests,
            issues: result.errors.map(issue => `${issue.operation ?? 'spec'}: ${issue.message}`)
        });
    };

    const choose = async (entry: ApiIndexEntry) => {
        fetchAbort.current?.abort();
        const abort = new AbortController();
        fetchAbort.current = abort;
        setSelected(entry);
        setReview({ state: 'loading', title: entry.title });
        try {
            const document = await fetchCatalogSpec(entry, { signal: abort.signal });
            if (abort.signal.aborted) return;
            const curated = entry.curated ? curatedApi(entry.id) : undefined;
            const subtitle = curated
                ? `Spec written by Flyspace from the provider's docs · ${entry.updated}`
                : entry.updated ? `Spec updated ${entry.updated} · ${entry.id}` : entry.id;
            showProposals(document, entry.title, subtitle, entry.specUrl, curated?.brokerOrigins);
        } catch (err) {
            if (abort.signal.aborted) return;
            setReview({ state: 'failed', message: err instanceof RegistryFetchError ? err.message : `${entry.title}: the spec could not be fetched` });
        }
    };

    const compilePasted = () => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(specText);
        } catch {
            setReview({ state: 'failed', message: 'OpenAPI document must be JSON' });
            return;
        }
        setSelected(null);
        const info = parsed && typeof parsed === 'object' ? (parsed as { info?: { title?: unknown } }).info : undefined;
        showProposals(parsed, typeof info?.title === 'string' ? info.title : 'Pasted API', 'Pasted OpenAPI document');
    };

    const place = (manifest: CapabilityManifest) => {
        const command = spatialSession.place(manifest.id, manifest.title, canvasCenter(placements.current++));
        if (command.lifecycle === 'committed' && command.subjects[0]) {
            useUIStore.getState().setSelectedBlock(command.subjects[0]);
            return true;
        }
        return false;
    };

    const installSelected = () => {
        const refs = [...secretSlots.keys()];
        const missing = refs.filter(ref => !secrets[ref]?.trim() && !capabilitySecrets.get(ref));
        if (missing.length > 0) {
            setErrors(missing.map(ref => `Enter the key for ${destinationOf(secretSlots.get(ref)!)?.origin ?? ref}`));
            return;
        }
        const oversized = refs.filter(ref => secretByteLength(secrets[ref]?.trim() ?? '') > MAX_SECRET_BYTES);
        if (oversized.length > 0) {
            setErrors(oversized.map(() => `A key is at most ${MAX_SECRET_BYTES} bytes`));
            return;
        }
        for (const ref of refs) {
            const value = secrets[ref]?.trim();
            if (value) capabilitySecrets.set(ref, value);
        }

        const problems: string[] = [];
        let placed: CapabilityManifest | null = null;
        for (const manifest of proposals) {
            if (!install[manifest.id]) continue;
            const result = installProposal(manifest);
            if (!result.ok) problems.push(`${manifest.title}: ${result.errors.join('; ')}`);
            else if (manifest.id === placeId) placed = result.manifest ?? manifest;
        }
        setSecrets({});
        if (problems.length > 0) {
            setErrors(problems);
            return;
        }
        if (placed && !place(placed)) {
            setErrors([`${placed.title} was installed but could not be placed. Place it from Your APIs.`]);
            return;
        }
        onClose();
    };

    const installCount = proposals.filter(p => install[p.id]).length;
    const placeName = proposals.find(p => p.id === placeId && install[p.id])?.title;

    return (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-api-title"
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.stopPropagation();
                        onClose();
                    }
                }}
                className="flex h-[min(720px,90vh)] w-[min(1040px,96vw)] flex-col overflow-hidden rounded-xl border border-[var(--citadel-border)] bg-[var(--citadel-surface)] shadow-2xl"
            >
                <header className="flex shrink-0 items-center gap-4 border-b border-[var(--citadel-border)] px-4 py-3">
                    <h2 id="add-api-title" className="text-base font-semibold text-[var(--text-primary)]">Add an API</h2>
                    <div role="tablist" aria-label="Add an API" className="flex gap-1 text-sm">
                        <button type="button" role="tab" aria-selected={tab === 'find'} onClick={() => setTab('find')}
                            className={`rounded-md px-2.5 py-1 ${tab === 'find' ? 'bg-[var(--citadel-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                            Find an API
                        </button>
                        <button type="button" role="tab" aria-selected={tab === 'yours'} onClick={() => setTab('yours')}
                            className={`rounded-md px-2.5 py-1 ${tab === 'yours' ? 'bg-[var(--citadel-elevated)] text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
                            Your APIs{installedCount > 0 ? ` (${installedCount})` : ''}
                        </button>
                    </div>
                    <button type="button" aria-label="Close" onClick={onClose}
                        className="ml-auto rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--citadel-elevated)] hover:text-[var(--text-primary)]">
                        <X className="h-4 w-4" />
                    </button>
                </header>

                {tab === 'yours' ? (
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <YourApis onPlace={manifest => { if (place(manifest)) onClose(); }} />
                    </div>
                ) : (
                    <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
                        {/* Left: find */}
                        <section aria-label="Find" className="flex min-h-0 flex-col border-b border-[var(--citadel-border)] md:border-b-0 md:border-r">
                            {source === 'search' ? (
                                <ApiSearch autoFocus selectedId={selected?.id ?? null} onSelect={entry => void choose(entry)} />
                            ) : (
                                <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
                                    <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs text-[var(--text-muted)]">
                                        OpenAPI document (JSON)
                                        <textarea
                                            aria-label="OpenAPI document"
                                            value={specText}
                                            onChange={event => setSpecText(event.target.value)}
                                            className="min-h-0 flex-1 resize-none rounded-lg border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] p-2 font-mono text-xs text-[var(--text-primary)]"
                                        />
                                    </label>
                                    <button type="button" onClick={compilePasted}
                                        className="self-start rounded-md border border-[var(--citadel-border)] px-3 py-1.5 text-xs hover:bg-[var(--citadel-elevated)]">
                                        Review
                                    </button>
                                </div>
                            )}
                            <button type="button" onClick={() => setSource(source === 'search' ? 'paste' : 'search')}
                                className="shrink-0 border-t border-[var(--citadel-border)] px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                                {source === 'search' ? 'Have a spec already? Paste OpenAPI' : '← Back to search'}
                            </button>
                        </section>

                        {/* Right: review and install */}
                        <section aria-label="Review" className="flex min-h-0 flex-col">
                            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                                {review.state === 'empty' ? (
                                    <div className="flex h-full flex-col items-center justify-center gap-1 text-center text-sm text-[var(--text-muted)]">
                                        <p>Choose an API to see what it does.</p>
                                        <p className="text-xs">Nothing is installed until you confirm.</p>
                                    </div>
                                ) : review.state === 'loading' ? (
                                    <p className="text-sm text-[var(--text-muted)]">Fetching {review.title}…</p>
                                ) : review.state === 'failed' ? (
                                    <p className="text-sm text-[var(--truth-red)]">{review.message}</p>
                                ) : (
                                    <div className="space-y-4">
                                        <ApiReview
                                            title={review.title}
                                            subtitle={review.subtitle}
                                            proposals={review.proposals}
                                            install={install}
                                            placeId={placeId}
                                            onToggleInstall={(id, value) => {
                                                setInstall(prev => ({ ...prev, [id]: value }));
                                                if (!value && placeId === id) setPlaceId(null);
                                            }}
                                            onPlace={setPlaceId}
                                        />
                                        {review.proposals.length === 0 ? (
                                            <p className="text-sm text-[var(--text-muted)]">This spec has no operations Flyspace can install.</p>
                                        ) : null}
                                        {review.issues.length > 0 ? (
                                            <details className="text-xs text-[var(--text-muted)]">
                                                <summary className="cursor-pointer">{review.issues.length} operation{review.issues.length === 1 ? '' : 's'} could not be compiled</summary>
                                                <ul className="mt-1 space-y-0.5">{review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
                                            </details>
                                        ) : null}
                                        {secretSlots.size > 0 ? (
                                            <fieldset className="space-y-2">
                                                <legend className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Keys</legend>
                                                {[...secretSlots].map(([ref, manifest]) => {
                                                    const destination = destinationOf(manifest);
                                                    return (
                                                        <label key={ref} className="block text-xs text-[var(--text-muted)]">
                                                            Key for <span className="font-mono text-[var(--text-secondary)]">{destination?.origin}</span>
                                                            {destination?.credential ? <span> · {destination.credential}</span> : null}
                                                            <input
                                                                type="password"
                                                                aria-label={`Key for ${destination?.origin ?? ref}`}
                                                                autoComplete="off"
                                                                value={secrets[ref] ?? ''}
                                                                onChange={event => setSecrets(prev => ({ ...prev, [ref]: event.target.value }))}
                                                                className="mt-1 w-full rounded-lg border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
                                                            />
                                                            {manifest.auth.hint ? (
                                                                <span className="mt-0.5 block text-[11px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">
                                                                    The API says: {manifest.auth.hint}
                                                                </span>
                                                            ) : null}
                                                            <span className="mt-0.5 block text-[10px]">Kept for this session only, never saved with your canvas.</span>
                                                        </label>
                                                    );
                                                })}
                                            </fieldset>
                                        ) : null}
                                    </div>
                                )}
                            </div>

                            {review.state === 'ready' && review.proposals.length > 0 ? (
                                <footer className="shrink-0 space-y-2 border-t border-[var(--citadel-border)] px-4 py-3">
                                    {errors.map(error => <p key={error} role="alert" className="text-xs text-[var(--truth-red)]">{error}</p>)}
                                    <div className="flex items-center gap-3">
                                        <p className="min-w-0 flex-1 text-xs text-[var(--text-muted)]">
                                            {installCount === 0
                                                ? 'Select at least one operation.'
                                                : placeName
                                                    ? <>Installs {installCount}. Places <span className="text-[var(--text-primary)]">{placeName}</span> on the canvas.</>
                                                    : `Installs ${installCount}. Nothing is placed on the canvas.`}
                                        </p>
                                        <button
                                            type="button"
                                            onClick={installSelected}
                                            disabled={installCount === 0}
                                            className="shrink-0 rounded-lg bg-[var(--citadel-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                                        >
                                            {placeName ? 'Install & place' : 'Install'}
                                        </button>
                                    </div>
                                </footer>
                            ) : null}
                        </section>
                    </div>
                )}
            </div>
        </div>
    );
}
