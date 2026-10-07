// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { getBlockView } from '@/core/registry/ViewRegistry';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore } from '@/core/stores';

beforeEach(() => {
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('Polymarket block', () => {
    it('renders its error state when the route reports an upstream failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            if (url.startsWith('/api/polymarket')) {
                return Response.json({ success: false, error: 'upstream_status' }, { status: 502 });
            }
            throw new TypeError('Failed to fetch');
        }));

        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get('polymarket_live_odds')!, { x: 0, y: 0 });
        const View = getBlockView('polymarket_live_odds')!;
        render(<View instanceId={instanceId} />);

        // The card and the store's status settle separately, so wait for both.
        await waitFor(() => {
            expect(screen.getByTestId('block-setup-card').getAttribute('data-kind')).toBe('error');
            expect(useBlockStore.getState().getBlock(instanceId)?.status).toBe('error');
        });
    });
});
