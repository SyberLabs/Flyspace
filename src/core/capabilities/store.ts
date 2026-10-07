// Persisted mirror of the installed set. Rehydration calls back into the
// registry, which revalidates before anything is registered again.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { vaultStorage } from '../vault';
import { CAPABILITY_STORE_KEY } from './importAdmission';
import type { CapabilityManifest } from './manifest';

interface CapabilityStoreState {
    manifests: CapabilityManifest[];
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

export const useCapabilityStore = create<CapabilityStoreState>()(
    persist(
        (): CapabilityStoreState => ({ manifests: [] }),
        {
            name: CAPABILITY_STORE_KEY,
            version: 1,
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({ manifests: state.manifests }),
            onRehydrateStorage: () => (state) => {
                const manifests = state?.manifests ?? [];
                if (rehydrateHandler) rehydrateHandler(manifests);
                else queuedRehydrates.push(manifests);
            }
        }
    )
);
