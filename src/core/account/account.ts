import { captureLiveStores, validateStoreEnvelopes } from './snapshot';
import { isVaultExport, prepareVaultImport, type OmniVaultExport } from '../vault/vaultExport';

export const ACCOUNT_ORIGIN = 'https://syberlabs.io';
export const SIGN_IN_URL = `${ACCOUNT_ORIGIN}/auth/signin?next=${encodeURIComponent('/admin/return?app=omni')}`;
export interface Account { user: { id: string; label: string }; portalUrl: string }
export interface SavedCanvas { id: string; app: string; name: string; createdAt: number; bytes: number; payload?: unknown }
const STORE_KEYS = new Set(['omni-blocks', 'omni-wires', 'omni-shells', 'omni-mind', 'omni-settings', 'omni-capabilities']);

/** Private backups omit retired credential stores and legacy provider keys. */
export function prepareAccountSnapshot(snapshot: OmniVaultExport): OmniVaultExport {
    const data: Record<string, string> = {};
    for (const [key, value] of Object.entries(snapshot.data)) {
        if (!STORE_KEYS.has(key)) continue;
        const parsed = JSON.parse(value);
        if (parsed?.state && typeof parsed.state === 'object') {
            if (key === 'omni-settings') {
                const { useMockData, gridSnapping, gridSize } = parsed.state;
                parsed.state = { useMockData, gridSnapping, gridSize };
            }
            if (key === 'omni-capabilities') {
                const { manifests, stale } = parsed.state;
                parsed.state = { manifests, stale };
            }
            if (key === 'omni-mind' && parsed.state.llmConfig) delete parsed.state.llmConfig.apiKey;
        }
        data[key] = JSON.stringify(parsed);
    }
    // Approval is local authority, not portable authority.
    return { ...snapshot, data: prepareVaultImport({ ...snapshot, data }).data };
}
export async function captureAccountSnapshot(): Promise<OmniVaultExport> {
    return prepareAccountSnapshot(captureLiveStores());
}
export function validateAccountSnapshot(payload: unknown): OmniVaultExport {
    if (!isVaultExport(payload) || Array.isArray(payload.data)
        || !Object.keys(payload.data).every(key => STORE_KEYS.has(key))) {
        throw new Error('This backup is not a compatible Flyspace canvas.');
    }
    validateStoreEnvelopes(payload);
    return prepareAccountSnapshot(payload);
}
export async function accountRequest<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${ACCOUNT_ORIGIN}/admin/api/v1/${path}`, {
        credentials: 'include', cache: 'no-store',
        ...(body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-SyberLabs-Account': 'v1' },
            body: JSON.stringify(body)
        })
    }).catch(() => { throw new Error('Account storage is unavailable. Your browser canvas is safe.'); });
    if (!response.ok) {
        const messages: Record<number, string> = {
            401: 'Sign in again to use your account.',
            403: 'Account access is unavailable from this address.',
            409: 'This save could not be added. Download a browser backup or review your saved things in the portal.',
            413: 'This canvas is too large for an account backup. Download it instead.',
        };
        throw new Error(messages[response.status] || 'Account storage is unavailable. Your browser canvas is safe.');
    }
    const result = await response.json();
    if (result.version !== 1) throw new Error('Account storage needs an update. Your browser canvas is safe.');
    return result as T;
}
export function downloadSnapshot(snapshot: OmniVaultExport, name = 'flyspace-canvas') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
