'use client';

import { useState, useSyncExternalStore } from 'react';
import { forgetRememberedKeys, isRemembering, rememberKeys, subscribeRemembering } from '@/core/capabilities/keyVault';

/** Whether keys are remembered on this device. Re-renders when the setting changes. */
export function useRememberingKeys(): boolean {
    return useSyncExternalStore(subscribeRemembering, isRemembering, () => false);
}

/** Where a key is kept, in one line, for under a key field. */
export function useKeyKeepingNote(): string {
    return useRememberingKeys()
        ? 'Remembered on this device, encrypted. Never saved with your canvas.'
        : 'Kept for this session only, never saved with your canvas.';
}

/**
 * The opt-in switch. On: keys are stored encrypted in this browser and come
 * back after a reload. Off: they are erased and last one session.
 */
export function RememberKeysToggle() {
    const on = useRememberingKeys();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    return (
        <div className="space-y-1 text-[11px]">
            <label className="flex items-start gap-2 text-[var(--text-primary)]">
                <input
                    type="checkbox"
                    checked={on}
                    disabled={busy}
                    onChange={async event => {
                        setBusy(true);
                        setError(null);
                        try {
                            if (event.target.checked) await rememberKeys();
                            else await forgetRememberedKeys();
                        } catch {
                            setError('This browser would not store keys; they stay for this session only.');
                        } finally {
                            setBusy(false);
                        }
                    }}
                    className="mt-0.5"
                />
                <span>Remember keys on this device</span>
            </label>
            <p className="pl-5 text-[10px] leading-snug text-[var(--text-muted)]">
                {on
                    ? 'Keys are stored encrypted in this browser, with a key it cannot export, and come back after a reload. They are never part of a canvas backup or sent to a server. Turning this off erases them here.'
                    : 'Off: keys last for this session only. On: they are stored encrypted in this browser and come back after a reload, never in a canvas backup or on a server.'}
            </p>
            {error ? <p role="alert" className="pl-5 text-[10px] text-[var(--truth-red)]">{error}</p> : null}
        </div>
    );
}
