// fake-indexeddb gives node a real (in-memory) IndexedDB implementation.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    vaultStorage,
    listVaultKeys,
    getVaultValue,
    VAULT_DB_NAME,
    __resetVaultConnection
} from './vaultStorage';
import { exportVault, importVault, isVaultExport, prepareVaultImport } from './vaultExport';

async function wipeVault(): Promise<void> {
    await __resetVaultConnection();
    await new Promise<void>((resolve, reject) => {
        const req = indexedDB.deleteDatabase(VAULT_DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => resolve();
    });
}

describe('vaultStorage — IndexedDB adapter (apex A2)', () => {
    beforeEach(async () => {
        localStorage.clear();
        await wipeVault();
    });

    it('round-trips set/get/remove', async () => {
        expect(await vaultStorage.getItem('omni-test')).toBeNull();

        await vaultStorage.setItem('omni-test', '{"state":{"a":1},"version":3}');
        expect(await vaultStorage.getItem('omni-test')).toBe('{"state":{"a":1},"version":3}');

        await vaultStorage.removeItem('omni-test');
        expect(await vaultStorage.getItem('omni-test')).toBeNull();
    });

    it('lazily migrates a legacy localStorage value on first read miss', async () => {
        // Pre-vault world: the store's data lives in localStorage.
        localStorage.setItem('omni-blocks', '{"state":{"blocks":[1,2]},"version":1}');

        // First vault read adopts it…
        const value = await vaultStorage.getItem('omni-blocks');
        expect(value).toBe('{"state":{"blocks":[1,2]},"version":1}');

        // …and it now lives in the vault itself (not just passthrough).
        expect(await getVaultValue('omni-blocks')).toBe('{"state":{"blocks":[1,2]},"version":1}');

        // Vault copy wins over a later-diverging localStorage copy.
        localStorage.setItem('omni-blocks', 'STALE');
        expect(await vaultStorage.getItem('omni-blocks')).toBe('{"state":{"blocks":[1,2]},"version":1}');
    });

    it('lists stored keys', async () => {
        await vaultStorage.setItem('omni-a', '1');
        await vaultStorage.setItem('omni-b', '2');
        expect((await listVaultKeys()).sort()).toEqual(['omni-a', 'omni-b']);
    });
});

describe('export / import (apex A2)', () => {
    beforeEach(async () => {
        localStorage.clear();
        await wipeVault();
    });

    it('export gathers BOTH engines; vault wins on conflicts', async () => {
        localStorage.setItem('omni-settings', 'LS-SETTINGS');   // not-yet-migrated store
        localStorage.setItem('omni-blocks', 'LS-STALE');        // legacy copy
        localStorage.setItem('unrelated-key', 'IGNORED');       // non-omni: excluded
        await vaultStorage.setItem('omni-blocks', 'VAULT-BLOCKS');

        const exported = await exportVault();

        expect(exported.format).toBe('omni-vault-export');
        expect(exported.data['omni-settings']).toBe('LS-SETTINGS');
        expect(exported.data['omni-blocks']).toBe('VAULT-BLOCKS'); // vault wins
        expect(exported.data['unrelated-key']).toBeUndefined();
        expect(isVaultExport(exported)).toBe(true);
    });

    it('import restores every key to both engines', async () => {
        const restored = await importVault({
            format: 'omni-vault-export',
            version: 1,
            exportedAt: Date.now(),
            data: { 'omni-blocks': 'RESTORED', 'omni-settings': 'RESTORED-LS' }
        });

        expect(restored.restored).toBe(2);
        expect(restored.needsApproval).toEqual([]);
        expect(await getVaultValue('omni-blocks')).toBe('RESTORED');
        expect(localStorage.getItem('omni-settings')).toBe('RESTORED-LS');
    });

    it('import drops approval from write and destructive capabilities; reads pass unchanged', async () => {
        const capabilities = JSON.stringify({
            state: {
                manifests: [
                    { id: 'cap_create', title: 'Create post', effect: 'write', approval: 'approved' },
                    { id: 'cap_delete', title: 'Delete post', effect: 'destructive', approval: 'denied' },
                    { id: 'cap_list', title: 'List posts', effect: 'read', approval: 'auto' },
                    { id: 'cap_sum', title: 'Sum', effect: 'compute', approval: 'auto' }
                ]
            },
            version: 1
        });
        const exported = {
            format: 'omni-vault-export' as const,
            version: 1 as const,
            exportedAt: Date.now(),
            data: { 'omni-capabilities': capabilities, 'omni-blocks': 'BLOCKS' }
        };

        const plan = prepareVaultImport(exported);
        expect(plan.needsApproval).toEqual([
            { id: 'cap_create', title: 'Create post', effect: 'write' },
            { id: 'cap_delete', title: 'Delete post', effect: 'destructive' }
        ]);
        // Pure: the export object itself is not rewritten.
        expect(exported.data['omni-capabilities']).toBe(capabilities);

        const report = await importVault(exported);
        expect(report.restored).toBe(2);
        expect(report.needsApproval.map(c => c.id)).toEqual(['cap_create', 'cap_delete']);
        expect(await getVaultValue('omni-blocks')).toBe('BLOCKS');

        // Neither engine carries the approval any more.
        for (const stored of [await getVaultValue('omni-capabilities'), localStorage.getItem('omni-capabilities')]) {
            expect(stored).not.toBeNull();
            expect(stored).not.toContain('approved');
            expect(stored).not.toContain('denied');
            const parsed = JSON.parse(stored as string) as { state: { manifests: Array<Record<string, unknown>> }; version: number };
            expect(parsed.version).toBe(1);
            expect(parsed.state.manifests.map(m => m.approval)).toEqual(['pending', 'pending', 'auto', 'auto']);
            expect(parsed.state.manifests[2]).toEqual({ id: 'cap_list', title: 'List posts', effect: 'read', approval: 'auto' });
        }
    });

    it('import writes a capability blob it cannot read as it came, and reports nothing', async () => {
        const report = await importVault({
            format: 'omni-vault-export',
            version: 1,
            exportedAt: Date.now(),
            data: { 'omni-capabilities': 'not json' }
        });
        expect(report.needsApproval).toEqual([]);
        expect(await getVaultValue('omni-capabilities')).toBe('not json');

        const pendingOnly = JSON.stringify({ state: { manifests: [{ id: 'cap_x', effect: 'write', approval: 'pending' }] }, version: 1 });
        const second = await importVault({
            format: 'omni-vault-export',
            version: 1,
            exportedAt: Date.now(),
            data: { 'omni-capabilities': pendingOnly }
        });
        // Already pending: reported (it still needs approval) and written byte for byte.
        expect(second.needsApproval).toEqual([{ id: 'cap_x', title: 'cap_x', effect: 'write' }]);
        expect(await getVaultValue('omni-capabilities')).toBe(pendingOnly);
    });

    it('isVaultExport rejects malformed/foreign payloads', () => {
        expect(isVaultExport(null)).toBe(false);
        expect(isVaultExport({ format: 'other', version: 1, data: {} })).toBe(false);
        expect(isVaultExport({ format: 'omni-vault-export', version: 1, data: { 'evil-key': 'x' } })).toBe(false);
        expect(isVaultExport({ format: 'omni-vault-export', version: 1, data: { 'omni-a': 42 } })).toBe(false);
    });
});
