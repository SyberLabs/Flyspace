// Secret values live here for the session only. Manifests store the slot
// name (secretRef). Nothing in this module is persisted.

const slots = new Map<string, string>();

export const capabilitySecrets = {
    set(ref: string, value: string): void {
        if (!ref || typeof value !== 'string' || value.length === 0) {
            throw new Error('A secret slot needs a name and a value');
        }
        slots.set(ref, value);
    },

    get(ref: string): string | undefined {
        return slots.get(ref);
    },

    /** Unbind one slot. The capability stays installed; its next run is AUTH_UNBOUND. */
    revoke(ref: string): boolean {
        return slots.delete(ref);
    },

    clear(): void {
        slots.clear();
    }
};
