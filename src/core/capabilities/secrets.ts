// Secret values live here for the session only. Manifests store the slot
// name (secretRef). Nothing in this module is persisted.

const slots = new Map<string, string>();
/** Slots the device vault never keeps: a sign-in token lasts one session (connect.ts). */
const sessionOnly = new Set<string>();
const listeners = new Set<() => void>();

function changed(): void {
    for (const listener of listeners) listener();
}

/**
 * The most a secret value may hold, in UTF-8 bytes. The same bound applies
 * where the value enters a slot here and where the server broker reads it
 * from a request body, so a value the slot accepted is never refused there.
 */
export const MAX_SECRET_BYTES = 4096;

export function secretByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

export const capabilitySecrets = {
    set(ref: string, value: string, options: { sessionOnly?: boolean } = {}): void {
        if (!ref || typeof value !== 'string' || value.length === 0) {
            throw new Error('A secret slot needs a name and a value');
        }
        if (secretByteLength(value) > MAX_SECRET_BYTES) {
            throw new Error(`A secret value is at most ${MAX_SECRET_BYTES} bytes`);
        }
        if (options.sessionOnly) sessionOnly.add(ref);
        else sessionOnly.delete(ref);
        slots.set(ref, value);
        changed();
    },

    get(ref: string): string | undefined {
        return slots.get(ref);
    },

    /** Unbind one slot. The capability stays installed; its next run is AUTH_UNBOUND. */
    revoke(ref: string): boolean {
        const removed = slots.delete(ref);
        sessionOnly.delete(ref);
        if (removed) changed();
        return removed;
    },

    /** The slots the opt-in device vault may keep (keyVault.ts): every one but a sign-in. */
    refs(): string[] {
        return [...slots.keys()].filter(ref => !sessionOnly.has(ref));
    },

    /** Whether a slot holds a value. The value itself is never handed to a view. */
    has(ref: string): boolean {
        return slots.has(ref);
    },

    /** Called after any slot is set, revoked, or cleared. Returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    clear(): void {
        slots.clear();
        sessionOnly.clear();
        changed();
    }
};
