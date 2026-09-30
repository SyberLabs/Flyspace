// ============================================
// PROJECT OMNI: OMNIVAULT — STORAGE ADAPTER (apex A2)
// IndexedDB-backed async StateStorage for zustand persist. Breaks the
// localStorage ceiling (~5MB, synchronous, easily wiped) for the core canvas
// stores; the Garden's longitudinal history (apex C1) lands here later.
//
// Key properties:
// - Drop-in behind createJSONStorage: stores keep their name/version/migrate.
// - LAZY LEGACY MIGRATION: on a read miss, the same key is pulled from
//   localStorage (the pre-vault home) and copied into the vault — existing
//   users lose nothing, with no migration orchestration step. The original
//   localStorage copy is left in place for one release as a fallback.
// - SSR/node-safe: every method no-ops when IndexedDB is unavailable
//   (server render, unit tests without fake-indexeddb).
// ============================================

import { openDB, type IDBPDatabase } from 'idb';
import type { StateStorage } from 'zustand/middleware';

export const VAULT_DB_NAME = 'omni-vault';
const VAULT_STORE_NAME = 'kv';
const VAULT_DB_VERSION = 1;

function idbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
    if (!dbPromise) {
        dbPromise = openDB(VAULT_DB_NAME, VAULT_DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
                    db.createObjectStore(VAULT_STORE_NAME);
                }
            }
        });
    }
    return dbPromise;
}

/**
 * Test hook: CLOSE the cached connection and drop it, so a subsequent
 * deleteDatabase isn't blocked by our own open handle (a pending delete
 * deadlocks every later openDB against the same database).
 */
export async function __resetVaultConnection(): Promise<void> {
    if (dbPromise) {
        try {
            (await dbPromise).close();
        } catch {
            // Already closed/broken — fine.
        }
    }
    dbPromise = null;
}

/**
 * The OmniVault StateStorage. Async — zustand persist hydrates the store
 * after mount; consumers already tolerate late-arriving state via the
 * hasMounted pattern, and the golden-path e2e guards reload persistence.
 */
export const vaultStorage: StateStorage = {
    async getItem(name: string): Promise<string | null> {
        if (!idbAvailable()) return null;
        try {
            const db = await getDb();
            const value = await db.get(VAULT_STORE_NAME, name);
            if (typeof value === 'string') return value;

            // Lazy legacy migration: first read after the upgrade finds the
            // pre-vault copy in localStorage and adopts it.
            if (typeof localStorage !== 'undefined') {
                const legacy = localStorage.getItem(name);
                if (legacy !== null) {
                    await db.put(VAULT_STORE_NAME, legacy, name);
                    return legacy;
                }
            }
            return null;
        } catch {
            // Storage layer must never throw into the app; degrade to empty.
            return null;
        }
    },

    async setItem(name: string, value: string): Promise<void> {
        if (!idbAvailable()) return;
        try {
            const db = await getDb();
            await db.put(VAULT_STORE_NAME, value, name);
        } catch {
            // Swallow: a failed write is preferable to a crashed canvas.
        }
    },

    async removeItem(name: string): Promise<void> {
        if (!idbAvailable()) return;
        try {
            const db = await getDb();
            await db.delete(VAULT_STORE_NAME, name);
        } catch {
            // Swallow (see setItem).
        }
    }
};

/** List every key currently stored in the vault (for export). */
export async function listVaultKeys(): Promise<string[]> {
    if (!idbAvailable()) return [];
    try {
        const db = await getDb();
        const keys = await db.getAllKeys(VAULT_STORE_NAME);
        return keys.map(String);
    } catch {
        return [];
    }
}

/** Read a raw vault value (for export). */
export async function getVaultValue(name: string): Promise<string | null> {
    if (!idbAvailable()) return null;
    try {
        const db = await getDb();
        const value = await db.get(VAULT_STORE_NAME, name);
        return typeof value === 'string' ? value : null;
    } catch {
        return null;
    }
}
