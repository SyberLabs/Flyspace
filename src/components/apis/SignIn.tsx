'use client';

import { useState, useSyncExternalStore } from 'react';
import { connectSignIn, isConnectConfigured, signInSlotOf, subscribeConnect, type SignInSlot } from '@/core/capabilities/connect';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { capabilitySecrets } from '@/core/capabilities/secrets';

export interface SignInState extends SignInSlot {
    signedIn: boolean;
    /** Whether this server has an OAuth client for the provider. */
    configured: boolean;
}

/** The sign-in a manifest needs, and whether this session has one. Null: it needs none. */
export function useSignIn(manifest: CapabilityManifest | undefined): SignInState | null {
    const slot = signInSlotOf(manifest);
    const signedIn = useSyncExternalStore(capabilitySecrets.subscribe, () => (slot ? capabilitySecrets.has(slot.slot) : false), () => false);
    const configured = useSyncExternalStore(subscribeConnect, () => (slot ? isConnectConfigured(slot.provider.id) : false), () => false);
    return slot ? { ...slot, signedIn, configured } : null;
}

/** The last path segment of a scope, which is how providers name it: calendar.readonly. */
function scopeLabel(scope: string): string {
    return scope.split('/').filter(Boolean).pop() ?? scope;
}

export function SignInPrompt({ manifest, signIn, again = false, onDone }: {
    manifest: CapabilityManifest;
    signIn: SignInState;
    again?: boolean;
    onDone?: () => void;
}) {
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const title = signIn.provider.title;

    const start = () => {
        setError(null);
        setPending(true);
        // Not awaited before the window opens: connectSignIn opens it synchronously.
        void connectSignIn(manifest).then(outcome => {
            setPending(false);
            if (outcome.ok) onDone?.();
            else setError(outcome.error);
        });
    };

    return (
        <div className="space-y-1 rounded-md border border-[var(--truth-amber)]/40 p-2">
            <p className="text-xs text-[var(--text-primary)]">
                {again ? `Sign in to ${title} again.` : `This API needs you to sign in to ${title}.`}
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
                Read-only access: {signIn.scopes.map(scopeLabel).join(', ')}. The sign-in lasts this session, about an hour, and is never saved with your canvas.
            </p>
            {signIn.configured ? (
                <button type="button" onClick={start} disabled={pending}
                    className="rounded-md border border-[var(--citadel-border)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-[var(--citadel-elevated)] disabled:opacity-60">
                    {pending ? 'Waiting for the sign-in window…' : `Sign in with ${title}`}
                </button>
            ) : (
                <p className="text-[10px] text-[var(--text-secondary)]">
                    {title} sign-in is not set up on this server. Its owner registers an OAuth client (DEPLOYMENT.md, &quot;Connect&quot;).
                </p>
            )}
            {error ? <p role="alert" className="text-[11px] text-[var(--truth-red)]">{error}</p> : null}
        </div>
    );
}
