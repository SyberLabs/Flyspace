// ============================================
// API SERVICE — settings-panel probes.
//
// These must hit the same routes the blocks use, and must never put a key
// on the URL. A green probe that used a different path would lie.
// ============================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testPolymarketConnection } from './api.service';

const originalFetch = globalThis.fetch;

beforeEach(() => {
    globalThis.fetch = vi.fn();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('testPolymarketConnection', () => {
    it('calls the same /api/polymarket route the block uses', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue({
            json: async () => ({ success: true })
        } as Response);

        await expect(testPolymarketConnection()).resolves.toBe(true);
        expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/api/polymarket');
    });

    it('reports an upstream outage as unhealthy', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue({
            json: async () => ({ success: false, error: 'upstream_status' })
        } as Response);

        await expect(testPolymarketConnection()).resolves.toBe(false);
    });
});
