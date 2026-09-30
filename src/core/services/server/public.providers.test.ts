import { describe, it, expect, afterEach, vi } from 'vitest';
import {
    fetchPublicProvider,
    isPublicProvider,
    PUBLIC_PROXY_IDS
} from './public.providers';

afterEach(() => {
    vi.unstubAllGlobals();
});

function captureFetch(body: unknown = { ok: true }) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return { json: async () => body } as unknown as Response;
    }));
    return calls;
}

describe('public proxy allowlist', () => {
    it('accepts only the keyless demo providers', () => {
        expect([...PUBLIC_PROXY_IDS].sort()).toEqual([
            'crossref',
            'frankfurter',
            'github',
            'openlibrary',
            'openmeteo',
            'usgs',
            'wikipedia'
        ].sort());
        expect(isPublicProvider('fred')).toBe(false);
        expect(isPublicProvider('polymarket')).toBe(false);
    });
});

describe('fetchPublicProvider', () => {
    it('rejects a keyed id without calling upstream', async () => {
        const calls = captureFetch();
        const { status, body } = await fetchPublicProvider('fred', {});
        expect(status).toBe(400);
        expect(JSON.stringify(body)).toMatch(/Unknown or keyed/);
        expect(calls).toHaveLength(0);
    });

    it('Open-Meteo hits the forecast URL with the requested coordinates', async () => {
        const calls = captureFetch({ current: { temperature_2m: 12 } });
        await fetchPublicProvider('openmeteo', { latitude: '51.5', longitude: '-0.12' });
        expect(calls[0].url).toContain('api.open-meteo.com/v1/forecast');
        expect(calls[0].url).toContain('latitude=51.5');
        expect(calls[0].url).toContain('longitude=-0.12');
    });

    it('USGS asks the GeoJSON feed, not a key', async () => {
        const calls = captureFetch({ features: [] });
        await fetchPublicProvider('usgs', {});
        expect(calls[0].url).toContain('earthquake.usgs.gov');
        expect(calls[0].url).not.toMatch(/api[_-]?key/i);
    });

    it('GitHub search stays on api.github.com with a User-Agent', async () => {
        const calls = captureFetch({ items: [] });
        await fetchPublicProvider('github', { q: 'omni' });
        expect(calls[0].url).toContain('api.github.com/search/repositories');
        expect(calls[0].url).toContain('q=omni');
        const headers = calls[0].init?.headers as Record<string, string>;
        expect(headers['User-Agent']).toMatch(/OmniOS/);
    });

    it('an upstream throw becomes a 502 without echoing the error text', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('secret-in-url'); }));
        const { status, body } = await fetchPublicProvider('wikipedia', {});
        expect(status).toBe(502);
        expect(JSON.stringify(body)).not.toContain('secret-in-url');
    });
});
