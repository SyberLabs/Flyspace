// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountRequest, prepareAccountSnapshot, validateAccountSnapshot, SIGN_IN_URL } from './account';
import { captureLiveStores } from './snapshot';
import type { OmniVaultExport } from '../vault/vaultExport';
const snapshot: OmniVaultExport = { format: 'omni-vault-export', version: 1, exportedAt: 1, data: {
    'omni-blocks': '{"state":{"blocks":[]}}',
    'omni-api-vault': '{"key":"secret"}',
    'omni-settings': '{"state":{"apiKeys":{"google":"secret"},"gridSize":20}}',
    'omni-mind': '{"state":{"llmConfig":{"apiKey":"secret","provider":"local"}}}',
    'omni-capabilities': '{"state":{"manifests":[{"id":"write","title":"Write","effect":"write","approval":"approved"}]}}',
} };
afterEach(() => vi.unstubAllGlobals());
describe('private account snapshots', () => {
    it('excludes obsolete credential stores, scrubs legacy keys and revokes imported approvals', () => {
        const result = prepareAccountSnapshot(snapshot);
        expect(result.data['omni-api-vault']).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('secret');
        expect(JSON.parse(result.data['omni-capabilities']).state.manifests[0].approval).toBe('pending');
        expect(JSON.parse(result.data['omni-settings']).state.gridSize).toBe(20);
        expect(snapshot.data['omni-settings']).toContain('secret');
    });
    it('refuses foreign payloads and unknown stores before restore', () => {
        expect(() => validateAccountSnapshot({ data: {} })).toThrow();
        expect(() => validateAccountSnapshot(snapshot)).toThrow();
        expect(() => validateAccountSnapshot({ ...snapshot, data: [] })).toThrow();
        expect(validateAccountSnapshot(captureLiveStores()).format).toBe('omni-vault-export');
    });
    it('rejects malformed and partial stores before local changes', () => {
        const full = captureLiveStores();
        localStorage.setItem('omni-blocks', 'original');
        expect(() => validateAccountSnapshot({ ...full, data: { ...full.data, 'omni-blocks': 'null' } })).toThrow();
        expect(() => validateAccountSnapshot({ ...full, data: {} })).toThrow();
        const bad = { ...full, data: { ...full.data, 'omni-wires': JSON.stringify({version:2,state:{wires:[{}]}}) } };
        expect(() => validateAccountSnapshot(bad)).toThrow();
        expect(localStorage.getItem('omni-blocks')).toBe('original');
    });
    it('rejects malformed stale capabilities and removes default-store action overrides', () => {
        const full = captureLiveStores();
        const capabilityBlob = JSON.parse(full.data['omni-capabilities']);
        capabilityBlob.state.stale = [null];
        expect(() => validateAccountSnapshot({ ...full, data: { ...full.data, 'omni-capabilities': JSON.stringify(capabilityBlob) } })).toThrow();
        capabilityBlob.state.stale = []; capabilityBlob.state.forgetStale = 'broken';
        const settingsBlob = JSON.parse(full.data['omni-settings']);
        settingsBlob.state.updateSetting = 'broken'; settingsBlob.state.toggleMockData = 'broken';
        const validated = validateAccountSnapshot({ ...full, data: { ...full.data, 'omni-capabilities': JSON.stringify(capabilityBlob), 'omni-settings': JSON.stringify(settingsBlob) } });
        expect(JSON.parse(validated.data['omni-settings']).state.updateSetting).toBeUndefined();
        expect(JSON.parse(validated.data['omni-settings']).state.toggleMockData).toBeUndefined();
        expect(JSON.parse(validated.data['omni-capabilities']).state.forgetStale).toBeUndefined();
    });
    it('uses internal sealed return navigation', () => {
        expect(new URL(SIGN_IN_URL).searchParams.get('next')).toBe('/admin/return?app=omni');
    });
});
describe('account protocol', () => {
    it('sends credentialed explicit JSON mutations with required preflight header', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response('{"version":1,"save":{"id":"1"}}'));
        vi.stubGlobal('fetch', fetch);
        const body = { app: 'omni', requestId: 'id', payload: {} };
        await accountRequest('saves', body, 'user-a');
        expect(fetch).toHaveBeenCalledWith('https://syberlabs.io/admin/api/v1/saves', expect.objectContaining({
            credentials: 'include', method: 'POST', body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json', 'X-SyberLabs-Account': 'v1', 'X-SyberLabs-Expected-User': 'user-a' }
        }));
    });
    it('explains network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(accountRequest('account')).rejects.toThrow('Your browser canvas is safe');
    });
    it('explains unavailable storage without changing local data', async () => {
        localStorage.setItem('omni-blocks', 'original');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
        await expect(accountRequest('saves', undefined, 'user-a')).rejects.toThrow('Your browser canvas is safe');
        expect(localStorage.getItem('omni-blocks')).toBe('original');
    });
    it('requires the captured identity for reads and never refreshes it from a changed cookie', async () => {
        let cookieUser = 'user-b';
        const fetch = vi.fn(async (_url, options) => {
            const expected = options.headers['X-SyberLabs-Expected-User'];
            return expected === cookieUser ? new Response('{"version":1,"saves":[]}') : new Response('{"version":1,"error":"account_changed"}', { status: 409 });
        });
        vi.stubGlobal('fetch', fetch);
        await expect(accountRequest('saves?app=omni', undefined, 'user-a')).rejects.toThrow('account changed');
        await expect(accountRequest('saves/id', undefined, 'user-a')).rejects.toThrow('account changed');
        cookieUser = 'user-a';
        await expect(accountRequest('saves', { requestId: 'original' }, 'user-b')).rejects.toThrow('account changed');
        expect(fetch).toHaveBeenCalledTimes(3);
        await expect(accountRequest('saves')).rejects.toThrow('Sign in again');
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});
