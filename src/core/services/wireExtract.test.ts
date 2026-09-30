import { describe, it, expect, beforeEach } from 'vitest';
// localStorage polyfilled in vitest.setup.ts.
import { extractBlockData } from './wire.service';
import { useBlockStore } from '@/core/stores';
import { DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';

function seed(id: string, data: unknown) {
    const block = {
        instance_id: id,
        schema: { block_id: 'x', display_name: 'X', category: 'truth' },
        status: 'connected',
        last_updated: Date.now(),
        data,
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId: 'root'
    } as unknown as BlockInstance;
    useBlockStore.setState({ blocks: [block], activeShellId: 'root' });
}

describe('extractBlockData — includes the signal, not just titles', () => {
    beforeEach(() => useBlockStore.setState({ blocks: [], activeShellId: 'root' }));

    it('formats PolymarketMarket[] with probabilities and volume (the live-bug regression)', () => {
        seed('pm', [
            {
                id: 'm1',
                question: 'Will X win the 2026 World Cup?',
                outcomes: [
                    { id: 'm1-yes', name: 'Yes', probability: 0.673 },
                    { id: 'm1-no', name: 'No', probability: 0.327 }
                ],
                volume: 45231091,
                liquidity: 0,
                endDate: '2026-07-01',
                category: 'Sports',
                tags: ['sports']
            }
        ]);

        const out = extractBlockData('pm', DEFAULT_WIRE_FILTERS)!;
        expect(out).toContain('Will X win the 2026 World Cup?');
        expect(out).toContain('67.3%');   // probability is present
        expect(out).toContain('32.7%');
        expect(out).toMatch(/Volume:/i);  // volume is present
    });

    it('formats OmniItem[] ({items}) with metadata, not just the title', () => {
        seed('oi', {
            items: [
                { id: 'c1', title: 'Bitcoin', metadata: { priceFormatted: '$65,000', priceChangePercent24h: 2.5, marketCapRank: 1 } }
            ]
        });

        const out = extractBlockData('oi', DEFAULT_WIRE_FILTERS)!;
        expect(out).toContain('Bitcoin');
        expect(out).toContain('$65,000');  // price metadata included
        expect(out).toContain('2.50%');    // 24h change included
    });

    it('formats a direct OmniItem[] array (metadata present)', () => {
        seed('arr', [
            { id: 'q1', title: 'Will it rain?', metadata: { probabilityPercent: 70, forecasters: 120 } }
        ]);

        const out = extractBlockData('arr', DEFAULT_WIRE_FILTERS)!;
        expect(out).toContain('Will it rain?');
        expect(out).toContain('70%');       // probability surfaced
        expect(out).toContain('forecasters: 120');
    });
});

describe('extractBlockData — empty content carries nothing', () => {
    beforeEach(() => useBlockStore.setState({ blocks: [], activeShellId: 'root' }));

    const empties: Array<[string, unknown]> = [
        ['an empty items array', { items: [] }],
        ['an empty direct array', []],
        ['an empty Memory pool', { poolId: 'memory', limit: 10, entries: [] }],
        ['a Memory pool of blank entries', { poolId: 'memory', limit: 10, entries: [{ content: '' }, { content: '  ' }] }],
        ['an empty markets array', { markets: [] }],
        ['an empty articles array', { articles: [] }],
        ['an empty text block', { content: '' }]
    ];

    it.each(empties)('returns null for %s (no placeholder to cite)', (_label, data) => {
        seed('empty', data);
        expect(extractBlockData('empty', DEFAULT_WIRE_FILTERS)).toBeNull();
        expect(extractBlockData('empty', { ...DEFAULT_WIRE_FILTERS, summaryOnly: true })).toBeNull();
    });

    const expiredMarket = {
        id: 'm', question: 'Old?', outcomes: [{ id: 'y', name: 'Yes', probability: 0.5 }],
        volume: 1, liquidity: 0, endDate: '2001-01-01', category: 'x', tags: []
    };

    it.each([
        ['wrapped { markets }', { markets: [expiredMarket] }],
        ['direct PolymarketMarket[]', [expiredMarket]]
    ])('returns null when a time window filters every market of a %s away', (_shape, data) => {
        seed('old', data);
        for (const summaryOnly of [true, false]) {
            expect(extractBlockData('old', { ...DEFAULT_WIRE_FILTERS, timeWindow: 'day', summaryOnly })).toBeNull();
        }
    });

    it('still returns text for non-empty content, skipping blank Memory entries', () => {
        seed('ok', { poolId: 'memory', limit: 10, entries: [{ content: '' }, { content: 'Kept.' }] });
        expect(extractBlockData('ok', DEFAULT_WIRE_FILTERS)).toBe('- Kept.');
    });
});
