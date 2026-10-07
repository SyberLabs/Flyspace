// Durability of the vault (MasterMind critique 2026-10-05, finding O4):
// persistence is requested once, a failed write is recorded, and a version
// change from another connection (a newer open or a delete) closes ours
// instead of blocking it, and never reloads the page under the user.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    vaultStorage,
    getVaultHealth,
    subscribeVaultHealth,
    VAULT_DB_NAME,
    __resetVaultConnection
} from './vaultStorage';

async function wipeVault(): Promise<void> {
    await __resetVaultConnection();
    await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(VAULT_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
}

function stubNavigatorStorage(persist: (() => Promise<boolean>) | undefined): void {
    vi.stubGlobal('navigator', persist ? { storage: { persist } } : {});
}

describe('vaultStorage — durability (O4)', () => {
    beforeEach(async () => {
        await wipeVault();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('starts with no verdict and no failure', () => {
        expect(getVaultHealth()).toEqual({ persisted: null, lastFailure: null });
    });

    it('requests persistent storage once, on first open, and exposes the grant', async () => {
        const persist = vi.fn().mockResolvedValue(true);
        stubNavigatorStorage(persist);

        await vaultStorage.setItem('omni-a', '1');
        await vaultStorage.setItem('omni-b', '2');
        await vaultStorage.getItem('omni-a');

        expect(persist).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(getVaultHealth().persisted).toBe(true));
    });

    it('records a declined grant as false', async () => {
        stubNavigatorStorage(vi.fn().mockResolvedValue(false));
        await vaultStorage.setItem('omni-a', '1');
        await vi.waitFor(() => expect(getVaultHealth().persisted).toBe(false));
    });

    it("reports 'unsupported' when navigator.storage.persist is missing", async () => {
        stubNavigatorStorage(undefined);
        await vaultStorage.setItem('omni-a', '1');
        expect(getVaultHealth().persisted).toBe('unsupported');
    });

    it('records a failing put (code + timestamp) instead of swallowing it, and notifies subscribers', async () => {
        stubNavigatorStorage(vi.fn().mockResolvedValue(true));
        const listener = vi.fn();
        const unsubscribe = subscribeVaultHealth(listener);
        const before = Date.now();

        vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
            throw new DOMException('quota', 'QuotaExceededError');
        });

        await expect(vaultStorage.setItem('omni-a', '1')).resolves.toBeUndefined();

        const { lastFailure } = getVaultHealth();
        expect(lastFailure?.code).toBe('QuotaExceededError');
        expect(lastFailure?.at).toBeGreaterThanOrEqual(before);
        expect(listener).toHaveBeenCalled();
        unsubscribe();

        // A later successful write does not erase the record: the user still
        // needs to know a save was lost.
        vi.restoreAllMocks();
        await vaultStorage.setItem('omni-a', '2');
        expect(getVaultHealth().lastFailure).toBe(lastFailure);
        expect(await vaultStorage.getItem('omni-a')).toBe('2');
    });

    it('yields to a newer open on versionchange without reloading; later writes record VersionError', async () => {
        stubNavigatorStorage(vi.fn().mockResolvedValue(true));
        const reload = vi.fn();
        vi.stubGlobal('window', { location: { reload } });

        await vaultStorage.setItem('omni-a', '1');

        const blocked = vi.fn();
        const newer = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open(VAULT_DB_NAME, 2);
            req.onblocked = blocked;
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });

        expect(newer.version).toBe(2);
        expect(blocked).not.toHaveBeenCalled();
        expect(reload).not.toHaveBeenCalled();

        // This tab's code only knows version 1, so its next write cannot open
        // the upgraded vault. That is recorded, not hidden, and not "fixed" by
        // reloading under the user.
        await vaultStorage.setItem('omni-a', '2');
        expect(getVaultHealth().lastFailure?.code).toBe('VersionError');
        expect(reload).not.toHaveBeenCalled();
        newer.close();
    });

    it('yields to deleteDatabase without reloading, and the next access recreates the vault', async () => {
        stubNavigatorStorage(vi.fn().mockResolvedValue(true));
        const reload = vi.fn();
        vi.stubGlobal('window', { location: { reload } });

        await vaultStorage.setItem('omni-a', '1');

        // What e2e/helpers.ts freshStart does from inside the page while the
        // app holds its connection open.
        const outcome = await new Promise<string>((resolve) => {
            const req = indexedDB.deleteDatabase(VAULT_DB_NAME);
            req.onsuccess = () => resolve('success');
            req.onerror = () => resolve('error');
            req.onblocked = () => resolve('blocked');
        });

        expect(outcome).toBe('success');
        expect(reload).not.toHaveBeenCalled();

        await vaultStorage.setItem('omni-b', '2');
        expect(await vaultStorage.getItem('omni-a')).toBeNull();
        expect(await vaultStorage.getItem('omni-b')).toBe('2');
        expect(getVaultHealth().lastFailure).toBeNull();
    });
});
