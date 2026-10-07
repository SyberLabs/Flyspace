'use client';

import { useState, useSyncExternalStore } from 'react';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { MAX_SECRET_BYTES, capabilitySecrets, secretByteLength } from '@/core/capabilities/secrets';
import { destinationOf } from './ApiReview';

/** The slot a person can fill by hand: a key, bearer token, or user:password. OAuth is bound by its connect flow. */
export function keySlotOf(manifest: CapabilityManifest | undefined): string | null {
    if (!manifest) return null;
    const { kind, secretRef } = manifest.auth;
    return (kind === 'apiKey' || kind === 'bearer' || kind === 'basic') && secretRef ? secretRef : null;
}

/** Whether the slot holds a key this session. Re-renders when any slot changes. */
export function useHasKey(ref: string | null): boolean {
    return useSyncExternalStore(
        capabilitySecrets.subscribe,
        () => (ref ? capabilitySecrets.has(ref) : false),
        () => false
    );
}

export interface KeyFieldProps {
    manifest: CapabilityManifest;
    /** Called after the key is in the slot. */
    onSaved?: () => void;
    onCancel?: () => void;
    autoFocus?: boolean;
    /** Inside a block, whose header already names the host: drop the visible origin line. */
    compact?: boolean;
}

/**
 * Enter or replace one API's key. It goes into the session's secret slot,
 * never into the canvas or the manifest, and is gone after a reload.
 */
export function KeyField({ manifest, onSaved, onCancel, autoFocus, compact }: KeyFieldProps) {
    const [value, setValue] = useState('');
    const [error, setError] = useState<string | null>(null);
    const ref = keySlotOf(manifest);
    const destination = destinationOf(manifest);
    if (!ref) return null;

    const save = () => {
        const key = value.trim();
        if (!key) {
            setError('Enter the key first');
            return;
        }
        if (secretByteLength(key) > MAX_SECRET_BYTES) {
            setError(`A key is at most ${MAX_SECRET_BYTES} bytes`);
            return;
        }
        capabilitySecrets.set(ref, key);
        setValue('');
        setError(null);
        onSaved?.();
    };

    const placeholder = manifest.auth.kind === 'basic' ? 'user:password' : 'Paste the key';
    return (
        <form
            className="space-y-1"
            onSubmit={event => {
                event.preventDefault();
                save();
            }}
        >
            <label className="block text-[11px] text-[var(--text-muted)]">
                {compact ? null : (
                    <>
                        Key for <span className="font-mono text-[var(--text-secondary)]">{destination?.origin}</span>
                        {destination?.credential ? <span> · {destination.credential}</span> : null}
                    </>
                )}
                <input
                    type="password"
                    aria-label={`Key for ${destination?.origin ?? ref}`}
                    autoComplete="off"
                    autoFocus={autoFocus}
                    placeholder={placeholder}
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--citadel-primary)] focus:outline-none"
                />
            </label>
            {manifest.auth.hint ? (
                <p className="text-[10px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">The API says: {manifest.auth.hint}</p>
            ) : null}
            {error ? <p role="alert" className="text-[10px] text-[var(--truth-red)]">{error}</p> : null}
            <div className="flex items-center gap-2">
                <button type="submit" className="rounded-md bg-[var(--citadel-primary)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-90">
                    Save key
                </button>
                {onCancel ? (
                    <button type="button" onClick={onCancel} className="text-[11px] text-[var(--text-muted)] underline">Cancel</button>
                ) : null}
                {compact ? null : <span className="text-[10px] text-[var(--text-muted)]">Kept for this session only.</span>}
            </div>
        </form>
    );
}
