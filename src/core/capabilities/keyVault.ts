// Opt-in, device-only memory for API keys. APEX_PLAN 6.3.
//
// Keys live in the session store (secrets.ts) and are gone after a reload.
// When a person turns on "Remember keys on this device", every key in the
// session is also written here, encrypted with AES-GCM under a key this
// browser generated and cannot export, and read back when Flyspace starts.
//
// What this protects: keys at rest in browser storage, copies of the profile
// folder, and canvas exports and account backups, which never include this
// database. What it does not: code running inside Flyspace itself can still
// use the key to decrypt, as it can read the session store. Turning the
// setting off erases everything here.

import { openDB, type IDBPDatabase } from 'idb';
import { capabilitySecrets } from './secrets';

export const KEY_VAULT_DB = 'flyspace-keys';
const META = 'meta';
const KEYS = 'keys';
const CRYPTO_KEY = 'crypto-key';
const REMEMBER = 'remember';

interface SealedKey {
    iv: Uint8Array<ArrayBuffer>;
    data: ArrayBuffer;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
    dbPromise ??= openDB(KEY_VAULT_DB, 1, {
        upgrade(database) {
            database.createObjectStore(META);
            database.createObjectStore(KEYS);
        }
    });
    return dbPromise;
}

// ---- whether it is on, for views --------------------------------------------

let remembering = false;
const listeners = new Set<() => void>();
function setRemembering(value: boolean): void {
    remembering = value;
    for (const listener of listeners) listener();
}

export function isRemembering(): boolean {
    return remembering;
}

export function subscribeRemembering(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

// ---- crypto -----------------------------------------------------------------

async function cryptoKey(create: boolean): Promise<CryptoKey | null> {
    const database = await db();
    const existing = (await database.get(META, CRYPTO_KEY)) as CryptoKey | undefined;
    if (existing || !create) return existing ?? null;
    // Non-extractable: stored as a CryptoKey object, never as bytes a script could read.
    const created = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await database.put(META, created, CRYPTO_KEY);
    return created;
}

async function seal(key: CryptoKey, ref: string, value: string): Promise<SealedKey> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    // The slot name is bound as associated data: a sealed value cannot be moved to another slot.
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(ref) }, key, new TextEncoder().encode(value));
    return { iv, data };
}

async function open(key: CryptoKey, ref: string, sealed: SealedKey): Promise<string> {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(sealed.iv), additionalData: new TextEncoder().encode(ref) }, key, sealed.data);
    return new TextDecoder().decode(plain);
}

// ---- keeping the vault in step with the session ------------------------------

let syncing: Promise<void> = Promise.resolve();
let restoring = false;

/** Write every session key, and drop any the session no longer holds. */
async function persistSession(): Promise<void> {
    const key = await cryptoKey(true);
    if (!key) return;
    const database = await db();
    const live = new Set(capabilitySecrets.refs());
    const stored = (await database.getAllKeys(KEYS)).map(String);
    for (const ref of stored) if (!live.has(ref)) await database.delete(KEYS, ref);
    for (const ref of live) {
        const value = capabilitySecrets.get(ref);
        if (value) await database.put(KEYS, await seal(key, ref, value), ref);
    }
}

function onSessionChange(): void {
    if (!remembering || restoring) return;
    syncing = syncing.then(persistSession).catch(() => { /* storage unavailable: the session still works */ });
}

let unsubscribe: (() => void) | null = null;

/**
 * Start at app load: read the setting, put remembered keys back into the
 * session, and follow the session from then on. Safe to call more than once.
 */
export async function startKeyVault(): Promise<{ restored: number }> {
    unsubscribe ??= capabilitySecrets.subscribe(onSessionChange);
    try {
        const database = await db();
        const on = (await database.get(META, REMEMBER)) === true;
        setRemembering(on);
        if (!on) return { restored: 0 };
        const key = await cryptoKey(false);
        if (!key) return { restored: 0 };
        let restored = 0;
        restoring = true;
        try {
            for (const ref of (await database.getAllKeys(KEYS)).map(String)) {
                const sealed = (await database.get(KEYS, ref)) as SealedKey | undefined;
                if (!sealed) continue;
                try {
                    capabilitySecrets.set(ref, await open(key, ref, sealed));
                    restored += 1;
                } catch {
                    await database.delete(KEYS, ref); // unreadable: drop it rather than fail every start
                }
            }
        } finally {
            restoring = false;
        }
        return { restored };
    } catch {
        return { restored: 0 }; // no IndexedDB here: keys stay session-only
    }
}

/** Turn remembering on and write the keys already in the session. */
export async function rememberKeys(): Promise<void> {
    // Flip at once so the switch answers the click; undo if this browser will not store.
    setRemembering(true);
    try {
        const database = await db();
        await database.put(META, true, REMEMBER);
        syncing = syncing.then(persistSession);
        await syncing;
    } catch (error) {
        setRemembering(false);
        throw error;
    }
}

/** Turn remembering off and erase every stored key and the encryption key. Session keys stay until reload. */
export async function forgetRememberedKeys(): Promise<void> {
    setRemembering(false);
    await syncing.catch(() => undefined);
    const database = await db();
    await database.clear(KEYS);
    await database.delete(META, CRYPTO_KEY);
    await database.put(META, false, REMEMBER);
}

/** Wait for pending writes (tests and teardown). */
export function keyVaultSettled(): Promise<void> {
    return syncing.catch(() => undefined);
}

/** Forget the open connection (tests). */
export function resetKeyVaultForTests(): void {
    unsubscribe?.();
    unsubscribe = null;
    dbPromise?.then(database => database.close()).catch(() => undefined);
    dbPromise = null;
    remembering = false;
    syncing = Promise.resolve();
}
