'use client';

import type { SignInSlot } from '@/core/capabilities/connect';

/** The last path segment of a scope, which is how providers name it: calendar.readonly. */
function scopeLabel(scope: string): string {
    return scope.split('/').filter(Boolean).pop() ?? scope;
}

export function SignInPrompt({ signIn }: { signIn: SignInSlot }) {
    const title = signIn.provider.title;
    return (
        <div className="space-y-1 rounded-md border border-[var(--truth-amber)]/40 p-2">
            <p className="text-xs text-[var(--text-primary)]">
                This API needs you to sign in to {title}.
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">
                Read-only access: {signIn.scopes.map(scopeLabel).join(', ')}. The sign-in lasts this session, about an hour, and is never saved with your canvas.
            </p>
            <p className="text-[10px] text-[var(--text-secondary)]">
                {title} sign-in is not set up on this server.
            </p>
        </div>
    );
}
