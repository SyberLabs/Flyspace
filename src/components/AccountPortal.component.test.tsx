// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPortal } from './AccountPortal';
import { accountRequest, captureAccountSnapshot } from '@/core/account/account';
vi.mock('@/core/account/account', async importOriginal => ({
    ...await importOriginal<typeof import('@/core/account/account')>(),
    accountRequest: vi.fn(), captureAccountSnapshot: vi.fn()
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
describe('account doorway', () => {
    it('shows an accessible signin link when no session exists', async () => {
        vi.mocked(accountRequest).mockRejectedValue(new Error('No session'));
        render(<AccountPortal />);
        expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toContain('app%3Domni');
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
        await screen.findByText('No account backups yet.');
        expect(captureAccountSnapshot).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await screen.findByText('Try again');
        await waitFor(() => expect((screen.getByRole('button', { name: 'Save to account' }) as HTMLButtonElement).disabled).toBe(false));
        fireEvent.click(screen.getByRole('button', { name: 'Save to account' }));
        await waitFor(() => expect(bodies).toHaveLength(2));
        expect(bodies[0]).toEqual(bodies[1]);
        expect(captureAccountSnapshot).toHaveBeenCalledTimes(1);
    });
});
