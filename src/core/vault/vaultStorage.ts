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
// - DURABILITY IS VISIBLE: the first open asks the browser for persistent
//   storage once, a failed write is recorded instead of swallowed, and a
//   version change from another tab closes this connection and reloads so
//   the upgrade is never blocked. `getVaultHealth` exposes all three.
// ============================================

import { openDB, type IDBPDatabase } from 'idb';
import type { StateStorage } from 'zustand/middleware';

export const VAULT_DB_NAME = 'omni-vault';
const VAULT_STORE_NAME = 'kv';
const VAULT_DB_VERSION = 1;

function idbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

/** The last vault operation that failed, by DOMException name (or a vault code). */
export interface VaultFailure {
    code: string;
    at: number;
}

export interface VaultHealth {
    /**
     * Result of the one `navigator.storage.persist()` request: `true` means the
     * browser promised not to evict the vault under storage pressure, `false`
     * means it declined, `'unsupported'` means the API is missing, `null` means
     * the vault has not opened yet.
     */
    persisted: boolean | 'unsupported' | null;
    lastFailure: VaultFailure | null;
}

const INITIAL_HEALTH: VaultHealth = { persisted: null, lastFailure: null };
let health: VaultHealth = INITIAL_HEALTH;
const healthListeners = new Set<() => void>();

function setHealth(patch: Partial<VaultHealth>): void {
    health = { ...health, ...patch };
    healthListeners.forEach(listener => listener());
}

/** Current durability state. Stable reference until it changes (useSyncExternalStore-safe). */
export function getVaultHealth(): VaultHealth {
    return health;
}

/** State before the vault opens; also the server snapshot. */
export function getInitialVaultHealth(): VaultHealth {
    return INITIAL_HEALTH;
}

export function subscribeVaultHealth(listener: () => void): () => void {
    healthListeners.add(listener);
    return () => { healthListeners.delete(listener); };
}

function recordFailure(error: unknown, fallback: string): void {
    const code = error instanceof Error && error.name ? error.name : fallback;
    setHealth({ lastFailure: { code, at: Date.now() } });
}

let persistRequested = false;

/** Ask once for persistent storage; the answer lands in `health.persisted`. */
function requestPersistence(): void {
    if (persistRequested) return;
    persistRequested = true;
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage || typeof storage.persist !== 'function') {
        setHealth({ persisted: 'unsupported' });
        return;
    }
    storage.persist().then(
        granted => setHealth({ persisted: granted }),
        () => setHealth({ persisted: false })
    );
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
    if (!dbPromise) {
        requestPersistence();
        dbPromise = openDB(VAULT_DB_NAME, VAULT_DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(VAULT_STORE_NAME)) {
                    db.createObjectStore(VAULT_STORE_NAME);
                }
            },
            // Another tab holds an older connection open, so our upgrade waits.
            blocked() {
                setHealth({ lastFailure: { code: 'VersionBlocked', at: Date.now() } });
            },
            // onversionchange: a newer tab wants to upgrade. Close so it is not
            // blocked, then reload onto the new version.
            blocking(_currentVersion, _blockedVersion, event) {
                (event.target as IDBDatabase | null)?.close();
                dbPromise = null;
                if (typeof window !== 'undefined') window.location.reload();
            },
            // The browser closed the connection (e.g. storage cleared); reopen next time.
            terminated() {
                dbPromise = null;
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
    persistRequested = false;
    health = INITIAL_HEALTH;
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
        } catch (error) {
            // Never throw into the app, but never hide it either: the Settings
            // panel shows the last failure so the user can export in time.
            recordFailure(error, 'WriteFailed');
        }
    },

    async removeItem(name: string): Promise<void> {
        if (!idbAvailable()) return;
        try {
            const db = await getDb();
            await db.delete(VAULT_STORE_NAME, name);
        } catch (error) {
            recordFailure(error, 'WriteFailed');
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
