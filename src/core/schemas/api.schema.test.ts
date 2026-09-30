import { describe, it, expect } from 'vitest';
import { API_CATALOG, getKeylessApis } from './api.schema';
import { blockRegistry } from '@/core/registry/BlockRegistry';

describe('catalog blockIds — the map shells use to know what they need', () => {
    it('every registered truth block maps to exactly one provider', () => {
        for (const block of blockRegistry.getByCategory('truth')) {
            const owners = API_CATALOG.filter(p => p.blockIds?.includes(block.block_id));
            expect(owners, block.block_id).toHaveLength(1);
        }
    });

    it("every provider's blockIds are registered blocks, claimed once", () => {
        const claimed = new Set<string>();
        for (const provider of API_CATALOG) {
            expect(provider.blockIds?.length, provider.id).toBeGreaterThan(0);
            for (const id of provider.blockIds ?? []) {
                expect(blockRegistry.has(id), `${provider.id} -> ${id}`).toBe(true);
                expect(claimed.has(id), `two providers claim ${id}`).toBe(false);
                claimed.add(id);
            }
        }
    });

    it('the three previously-wrong mappings are accurate', () => {
        const byId = Object.fromEntries(API_CATALOG.map(p => [p.id, p.blockIds]));
        expect(byId.coingecko).toEqual(['coingecko_crypto']);
        expect(byId.openalex).toEqual(['openalex_works']);
        expect(byId.hackernews).toEqual(['hackernews_feed']);
    });
});

describe('keyless demo catalog', () => {
    it('ships at least 12 providers that need no key', () => {
        const keyless = API_CATALOG.filter(p => !p.requiresAuth);
        expect(keyless.map(p => p.id).sort()).toEqual([
            'coingecko',
            'crossref',
            'frankfurter',
            'github',
            'hackernews',
            'openalex',
            'openlibrary',
            'openmeteo',
            'polymarket',
            'usgs',
            'wikipedia',
            'worldbank'
        ].sort());
        expect(keyless).toHaveLength(12);
        for (const provider of keyless) {
            expect(provider.serverKeyed, provider.id).toBeFalsy();
        }
        expect(getKeylessApis().map(p => p.id).sort()).toEqual(keyless.map(p => p.id).sort());
    });
});
