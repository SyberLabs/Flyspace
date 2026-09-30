'use client';

import type { ReactNode } from 'react';
import { AlertCircle, Settings2 } from 'lucide-react';

// The server names the env var to set. That is configuration, not a crash.
const SETUP_HINT = /\b[A-Z][A-Z0-9_]*_KEY\b|\.env\b/;

function isSetupError(message: string): boolean {
    return SETUP_HINT.test(message);
}

export function BlockSetupCard({ message }: { message: string }) {
    const setup = isSetupError(message);
    const Icon = setup ? Settings2 : AlertCircle;

    return (
        <div
            data-testid="block-setup-card"
            data-kind={setup ? 'setup' : 'error'}
            className="flex flex-col items-center justify-center text-center py-8 px-4"
        >
            <Icon
                className={
                    setup
                        ? 'w-6 h-6 mb-2 text-[var(--truth-amber)] opacity-80'
                        : 'w-6 h-6 mb-2 text-[var(--text-muted)] opacity-70'
                }
            />
            <p className="text-xs font-medium text-[var(--text-primary)]">
                {setup ? 'Needs configuration' : "Couldn't load"}
            </p>
            <p className="mt-1.5 text-xs text-[var(--text-muted)] max-w-[240px] leading-relaxed break-words">
                {message}
            </p>
        </div>
    );
}

export function BlockBodyState({
    error,
    isLoading,
    isEmpty,
    loadingLabel = 'Loading...',
    emptyLabel = 'No results',
    children
}: {
    error?: string | null;
    isLoading: boolean;
    isEmpty: boolean;
    loadingLabel?: string;
    emptyLabel?: string;
    children: ReactNode;
}) {
    if (error) return <BlockSetupCard message={error} />;
    if (isEmpty) {
        return (
            <div className="text-center text-[var(--text-muted)] py-8 text-xs">
                {isLoading ? loadingLabel : emptyLabel}
            </div>
        );
    }
    return <>{children}</>;
}
