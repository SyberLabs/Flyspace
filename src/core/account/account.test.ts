// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountRequest, prepareAccountSnapshot, validateAccountSnapshot, SIGN_IN_URL } from './account';
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
        expect(validateAccountSnapshot(prepareAccountSnapshot(snapshot)).format).toBe('omni-vault-export');
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
        await accountRequest('saves', body);
        expect(fetch).toHaveBeenCalledWith('https://syberlabs.io/admin/api/v1/saves', expect.objectContaining({
            credentials: 'include', method: 'POST', body: JSON.stringify(body),
            headers: { 'Content-Type': 'application/json', 'X-SyberLabs-Account': 'v1' }
        }));
    });
    it('explains network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
        await expect(accountRequest('account')).rejects.toThrow('Your browser canvas is safe');
    });
    it('explains unavailable storage without changing local data', async () => {
        localStorage.setItem('omni-blocks', 'original');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
        await expect(accountRequest('saves')).rejects.toThrow('Your browser canvas is safe');
        expect(localStorage.getItem('omni-blocks')).toBe('original');
    });
});
