// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPortal } from './AccountPortal';
import { importVault } from '@/core/vault/vaultExport';
import { accountRequest, captureAccountSnapshot } from '@/core/account/account';
import { captureLiveStores } from '@/core/account/snapshot';
vi.mock('@/core/account/account', async importOriginal => ({
    ...await importOriginal<typeof import('@/core/account/account')>(),
    accountRequest: vi.fn(), captureAccountSnapshot: vi.fn()
}));
vi.mock('@/core/vault/vaultExport', async importOriginal => ({
    ...await importOriginal<typeof import('@/core/vault/vaultExport')>(), importVault: vi.fn()
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe('account doorway', () => {
    it('keeps the original identity, payload and UUID across cookie switches and retries', async () => {
        let cookieUser = 'a'; const attempts: { body: unknown; user: string | undefined }[] = [];
        vi.mocked(captureAccountSnapshot).mockResolvedValue({ format: 'omni-vault-export', version: 1, exportedAt: 1, data: {} });
        vi.mocked(accountRequest).mockImplementation(async (path, body, expected) => {
            if (path === 'account') return { user: { id: cookieUser, label: cookieUser } } as never;
            if (path.startsWith('saves?')) return { saves: [] } as never;
            attempts.push({ body, user: expected });
            if (expected !== cookieUser) throw new Error('Cookie account changed');
            throw new Error('Try again');
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        await screen.findByRole('heading', { name: 'a' });
        cookieUser = 'b'; // Cookie switches before the operation, while displayed identity stays A.
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText('Cookie account changed');
        expect(attempts[0].user).toBe('a');
        fireEvent(window, new Event('focus'));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'a' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        await screen.findByRole('heading', { name: 'b' });
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText(/This retry belongs to your previous account/);
        expect(attempts).toHaveLength(1); // Refuse rather than relabel the A payload as B.
        cookieUser = 'a';
        fireEvent(window, new Event('focus'));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'b' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        await screen.findByRole('heading', { name: 'a' });
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText('Try again');
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toEqual(attempts[0]);
        expect(captureAccountSnapshot).toHaveBeenCalledTimes(1);
    });
    it('ignores a stale list when the account changes in flight', async () => {
        let cookieUser = 'a'; let resolveOld!: (value: never) => void;
        const oldList = new Promise<never>(resolve => { resolveOld = resolve; });
        vi.mocked(accountRequest).mockImplementation(async (path, _body, expected) => {
            if (path === 'account') return { user: { id: cookieUser, label: cookieUser } } as never;
            if (expected === 'a') return oldList;
            return { saves: [{ id: 'b-save', name: 'B backup', app: 'omni', createdAt: 1, bytes: 1 }] } as never;
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        await screen.findByRole('heading', { name: 'a' });
        cookieUser = 'b'; fireEvent(window, new Event('focus'));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'a' })).toBeNull());
        fireEvent.click(screen.getByRole('button', { name: 'Account' }));
        await screen.findByText('B backup');
        await act(async () => { resolveOld({ saves: [{ id: 'a-save', name: 'A backup', app: 'omni', createdAt: 1, bytes: 1 }] } as never); });
        await waitFor(() => expect(screen.getByText('B backup')).toBeTruthy());
        expect(screen.queryByText('A backup')).toBeNull();
    });
    it('never imports a stale detail response after switching accounts', async () => {
        let cookieUser = 'a'; let resolveDetail!: (value: never) => void;
        const detail = new Promise<never>(resolve => { resolveDetail = resolve; });
        vi.mocked(accountRequest).mockImplementation(async (path, _body, expected) => {
            if (path === 'account') return { user: { id: cookieUser, label: cookieUser } } as never;
            if (path.startsWith('saves?')) return { saves: [{ id: 'a-save', name: 'A backup', app: 'omni', createdAt: 1, bytes: 1 }] } as never;
            expect(expected).toBe('a'); return detail;
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Restore backup/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore canvas' }));
        await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('saves/a-save', undefined, 'a'));
        cookieUser = 'b'; fireEvent(window, new Event('focus'));
        await waitFor(() => expect(screen.queryByRole('heading', { name: 'a' })).toBeNull());
        await act(async () => { resolveDetail({ save: { app: 'omni', payload: captureLiveStores() } } as never); });
        expect(importVault).not.toHaveBeenCalled();
        expect(captureAccountSnapshot).not.toHaveBeenCalled();
    });
    it('shows an accessible signin link when no session exists', async () => {
        vi.mocked(accountRequest).mockRejectedValue(new Error('No session'));
        render(<AccountPortal />);
        expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain('app%3Domni');
    });
    it('rejects a malformed backup before restoring browser storage', async () => {
        localStorage.setItem('omni-blocks', 'original');
        vi.mocked(accountRequest).mockImplementation(async path => {
            if (path === 'account') return { user: { id: '1', label: 'Seth' } } as never;
            if (path.startsWith('saves?')) return { saves: [{ id: 'bad', name: 'Broken', app: 'omni', createdAt: 1, bytes: 1 }] } as never;
            return { save: { app: 'omni', payload: { format: 'omni-vault-export', version: 1, data: { 'omni-blocks': 'null' } } } } as never;
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        fireEvent.click(await screen.findByRole('button', { name: /^Restore backup/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Restore canvas' }));
        await screen.findByText('This canvas backup is incomplete.');
        expect(importVault).not.toHaveBeenCalled();
        expect(localStorage.getItem('omni-blocks')).toBe('original');
    });
    it('reports a completed save even when refreshing its list fails', async () => {
        let posted = false;
        vi.mocked(captureAccountSnapshot).mockResolvedValue({ format: 'omni-vault-export', version: 1, exportedAt: 1, data: {} });
        vi.mocked(accountRequest).mockImplementation(async (path) => {
            if (path === 'account') return { user: { id: '1', label: 'Seth' } } as never;
            if (path.startsWith('saves?')) { if (posted) throw new Error('Offline'); return { saves: [] } as never; }
            posted = true; return { save: { id: '1' } } as never;
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        await screen.findByText(/^No account backups yet\./);
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText('Your backup was saved. The list is unavailable; view saved things in your portal.');
        expect(vi.mocked(accountRequest).mock.calls.filter(([path]) => path === 'saves')).toHaveLength(1);
    });
    it('never uploads automatically and reuses a retry requestId after failure', async () => {
        const bodies: unknown[] = [];
        vi.mocked(captureAccountSnapshot).mockResolvedValue({ format: 'omni-vault-export', version: 1, exportedAt: 1, data: {} });
        vi.mocked(accountRequest).mockImplementation(async (path, body) => {
            if (path === 'account') return { user: { id: '1', label: 'Seth' }, portalUrl: 'https://syberlabs.io/admin/' } as never;
            if (path.startsWith('saves?')) return { saves: [] } as never;
            bodies.push(body); throw new Error('Try again');
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        await screen.findByText(/^No account backups yet\./);
        expect(captureAccountSnapshot).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText('Try again');
        await waitFor(() => expect((screen.getByRole('button', { name: 'Save to account' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[0]).toEqual(bodies[1]);
        expect(captureAccountSnapshot).toHaveBeenCalledTimes(1);
    });
    it('distinguishes delayed loading, failed lists and a confirmed empty list without uploading', async () => {
        let rejectList!: (error: Error) => void;
        let calls = 0;
        vi.mocked(accountRequest).mockImplementation(async path => {
            if (path === 'account') return { user: { id: '1', label: 'Seth' } } as never;
            calls++;
            if (calls === 1) return new Promise((_resolve, reject) => { rejectList = reject; });
            return { saves: [] } as never;
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        await screen.findByText('Loading account backups…');
        expect(screen.queryByText(/^No account backups/)).toBeNull();
        await act(async () => rejectList(new Error('Offline')));
        expect((await screen.findByRole('alert')).textContent).toContain('Offline');
        expect(screen.queryByText(/^No account backups/)).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Reload backups' }));
        await screen.findByText(/^No account backups yet\./);
        expect(screen.queryByRole('alert')).toBeNull();
        expect(captureAccountSnapshot).not.toHaveBeenCalled();
        expect(calls).toBe(2);
    });
    it('focuses safe restore cancellation, previews metadata and returns focus after Escape', async () => {
        const createdAt = Date.UTC(2026, 9, 8, 16, 30);
        vi.mocked(accountRequest).mockImplementation(async path => path === 'account'
            ? { user: { id: '1', label: 'Seth' } } as never
            : { saves: [{ id: 'saved', name: 'Research orbit', app: 'omni', createdAt, bytes: 4096 }] } as never);
        render(<AccountPortal />);
        const accountButton = await screen.findByRole('button', { name: 'Account' });
        fireEvent.click(accountButton);
        expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Seth' }));
        fireEvent.click(await screen.findByRole('button', { name: 'Restore backup Research orbit' }));
        const preview = screen.getByRole('group', { name: 'Restore Research orbit' });
        expect(preview.querySelector('time')?.dateTime).toBe(new Date(createdAt).toISOString());
        expect(preview.textContent).toContain('4 KB');
        expect(document.activeElement).toBe(within(preview).getByRole('button', { name: 'Cancel' }));
        expect(importVault).not.toHaveBeenCalled();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('group')).toBeNull();
        expect(document.activeElement).toBe(accountButton);
        expect(accountRequest).not.toHaveBeenCalledWith('saves/saved', undefined, '1');
    });
    it('announces a slow explicit save, ignores Escape while busy and avoids redundant list loads', async () => {
        let finishSave!: (value: never) => void;
        let lists = 0;
        vi.mocked(captureAccountSnapshot).mockResolvedValue({ format: 'omni-vault-export', version: 1, exportedAt: 1, data: {} });
        vi.mocked(accountRequest).mockImplementation(async path => {
            if (path === 'account') return { user: { id: '1', label: 'Seth' } } as never;
            if (path.startsWith('saves?')) { lists++; return { saves: [] } as never; }
            return new Promise(resolve => { finishSave = resolve; });
        });
        render(<AccountPortal />);
        fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
        await screen.findByText(/^No account backups yet\./);
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText('Saving a private backup…');
        expect((screen.getByRole('button', { name: 'Saving backup…' }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.getByRole('heading', { name: 'Seth' })).toBeTruthy();
        expect(lists).toBe(1);
        await act(async () => finishSave({ save: { id: 'saved' } } as never));
        await screen.findByText('Private canvas backup saved to your account.');
        expect(lists).toBe(2);
    });

});
