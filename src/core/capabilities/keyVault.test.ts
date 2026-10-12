import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import {
    forgetRememberedKeys,
    isRemembering,
    KEY_VAULT_DB,
    keyVaultSettled,
    rememberKeys,
    resetKeyVaultForTests,
    startKeyVault
} from './keyVault';
import { capabilitySecrets } from './secrets';
import { captureLiveStores } from '../account/snapshot';

const SLOT = 'cred_fred_query_api_key';
const KEY = 'abcdef0123456789abcdef0123456789';

/** A reload: the session store empties and the vault starts again from storage. */
async function reload(): Promise<{ restored: number }> {
    await keyVaultSettled();
    resetKeyVaultForTests();
    capabilitySecrets.clear();
    return startKeyVault();
}

/** Every byte the vault database holds, as text, to look for a plaintext key. */
async function rawVault(): Promise<string> {
    const database = await openDB(KEY_VAULT_DB, 1);
    const records = await database.getAll('keys');
    database.close();
    return records.map(record => {
        const bytes = new Uint8Array(record.data as ArrayBuffer);
        return new TextDecoder('latin1').decode(bytes) + JSON.stringify(record);
    }).join('\n');
}

beforeEach(async () => {
    resetKeyVaultForTests();
    capabilitySecrets.clear();
    indexedDB.deleteDatabase(KEY_VAULT_DB);
    await startKeyVault();
});

afterEach(async () => {
    await keyVaultSettled();
    resetKeyVaultForTests();
    capabilitySecrets.clear();
});

describe('the device key vault', () => {
    it('is off by default: a key does not survive a reload', async () => {
        expect(isRemembering()).toBe(false);
        capabilitySecrets.set(SLOT, KEY);
        expect(await reload()).toEqual({ restored: 0 });
        expect(capabilitySecrets.get(SLOT)).toBeUndefined();
    });

    it('when on, puts keys back after a reload, including ones saved before it was turned on', async () => {
        capabilitySecrets.set(SLOT, KEY);
        await rememberKeys();
        capabilitySecrets.set('cred_other', 'second-key');
        expect(await reload()).toEqual({ restored: 2 });
        expect(isRemembering()).toBe(true);
        expect(capabilitySecrets.get(SLOT)).toBe(KEY);
        expect(capabilitySecrets.get('cred_other')).toBe('second-key');
    });

    it('never stores a key in plain text', async () => {
        await rememberKeys();
        capabilitySecrets.set(SLOT, KEY);
        await keyVaultSettled();
        const raw = await rawVault();
        expect(raw.length).toBeGreaterThan(0);
        expect(raw).not.toContain(KEY);
    });

    it('follows the session: a forgotten key is gone from storage too', async () => {
        await rememberKeys();
        capabilitySecrets.set(SLOT, KEY);
        capabilitySecrets.revoke(SLOT);
        expect(await reload()).toEqual({ restored: 0 });
    });

    it('cannot be tricked into handing one slot’s key to another', async () => {
        await rememberKeys();
        capabilitySecrets.set(SLOT, KEY);
        await keyVaultSettled();
        // Move the sealed record under another slot name: decryption fails, and the record is dropped.
        const database = await openDB(KEY_VAULT_DB, 1);
        await database.put('keys', await database.get('keys', SLOT), 'cred_attacker');
        await database.delete('keys', SLOT);
        database.close();
        expect(await reload()).toEqual({ restored: 0 });
        expect(capabilitySecrets.get('cred_attacker')).toBeUndefined();
    });

    it('erases everything when turned off', async () => {
        await rememberKeys();
        capabilitySecrets.set(SLOT, KEY);
        await forgetRememberedKeys();
        expect(isRemembering()).toBe(false);
        expect(await rawVault()).toBe('');
        expect(await reload()).toEqual({ restored: 0 });
    });

    it('is never part of a canvas backup', async () => {
        await rememberKeys();
        capabilitySecrets.set(SLOT, KEY);
        await keyVaultSettled();
        expect(JSON.stringify(captureLiveStores())).not.toContain(KEY);
    });
});
