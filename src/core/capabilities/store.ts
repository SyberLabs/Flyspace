// Persisted mirror of the installed set. Rehydration calls back into the
// registry, which revalidates before anything is registered again.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { vaultStorage } from '../vault';
import type { CapabilityManifest } from './manifest';

/**
 * A persisted manifest the current manifest rule cannot restore. It is kept
 * here, with the stored body, instead of being dropped on reload. The reader
 * re-installs the capability from its source; this entry only says which.
 */
export interface StaleCapability {
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

const ORIGIN_RULE = 'MCP manifests now carry the server origin, which this one predates and does not name. Re-install it from its server.';

/** An MCP manifest persisted before `transport.origin` existed. Nothing in it names the server URL. */
function isOriginlessMcp(entry: unknown): entry is { id: string; title?: unknown } {
    if (typeof entry !== 'object' || entry === null) return false;
    const record = entry as { id?: unknown; transport?: { kind?: unknown; origin?: unknown } };
    return typeof record.id === 'string'
        && typeof record.transport === 'object' && record.transport !== null
        && record.transport.kind === 'mcp'
        && typeof record.transport.origin !== 'string';
}

/**
 * omni-capabilities persist migrations.
 * v1 → v2: the mcp transport gained `origin`, and the credential slot and
 * capability id are derived from it. A stored MCP manifest has no URL to
 * derive it from, so it moves to `stale` rather than failing validation on
 * restore (which would drop it from the next persisted write).
 */
export function migrateCapabilityStore(persistedState: unknown, fromVersion: number): Record<string, unknown> {
    const persisted = { ...((persistedState || {}) as Record<string, unknown>) };
    const manifests = Array.isArray(persisted.manifests) ? persisted.manifests : [];
    const stale: StaleCapability[] = Array.isArray(persisted.stale) ? [...(persisted.stale as StaleCapability[])] : [];
    if (fromVersion < 2) {
        const kept: unknown[] = [];
        for (const entry of manifests) {
            if (isOriginlessMcp(entry)) {
                stale.push({
                    id: entry.id,
                    title: typeof entry.title === 'string' ? entry.title : entry.id,
                    reason: ORIGIN_RULE,
                    manifest: entry
                });
            } else {
                kept.push(entry);
            }
        }
        persisted.manifests = kept;
    }
    persisted.stale = stale;
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
            name: 'omni-capabilities',
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
