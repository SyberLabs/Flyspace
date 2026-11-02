// Persisted mirror of the installed set. Rehydration calls back into the
// registry, which revalidates before anything is registered again.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { vaultStorage } from '../vault';
import { CAPABILITY_STORE_KEY } from './importAdmission';
import type { CapabilityManifest } from './manifest';

/**
 * A persisted manifest the current manifest rule cannot restore. It is kept
 * here, with the stored body, instead of being dropped on reload. The reader
 * re-installs the capability from its source; this entry only says which.
 */
interface StaleCapability {
    id: string;
    title: string;
    reason: string;
    manifest: unknown;
}

interface CapabilityStoreState {
    manifests: CapabilityManifest[];
    stale: StaleCapability[];
    forgetStale: (id: string) => void;
}

type RehydrateHandler = (manifests: CapabilityManifest[]) => void;

let rehydrateHandler: RehydrateHandler | null = null;
const queuedRehydrates: CapabilityManifest[][] = [];

/** Registry subscribes once it has finished initializing. */
export function onCapabilityRehydrate(handler: RehydrateHandler): void {
    rehydrateHandler = handler;
    while (queuedRehydrates.length > 0) {
        const manifests = queuedRehydrates.shift();
        if (manifests) handler(manifests);
    }
}

/** Stored state from before `stale` existed gets an empty list. */
export function migrateCapabilityStore(persistedState: unknown): Record<string, unknown> {
    const persisted = { ...((persistedState || {}) as Record<string, unknown>) };
    if (!Array.isArray(persisted.stale)) persisted.stale = [];
    return persisted;
}

export const useCapabilityStore = create<CapabilityStoreState>()(
    persist(
        (set): CapabilityStoreState => ({
            manifests: [],
            stale: [],
            forgetStale: (id) => set(state => ({ stale: state.stale.filter(entry => entry.id !== id) }))
        }),
        {
            name: CAPABILITY_STORE_KEY,
            version: 2,
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({ manifests: state.manifests, stale: state.stale }),
            migrate: migrateCapabilityStore,
            onRehydrateStorage: () => (state) => {
                const manifests = state?.manifests ?? [];
                if (rehydrateHandler) rehydrateHandler(manifests);
                else queuedRehydrates.push(manifests);
            }
        }
    )
);
