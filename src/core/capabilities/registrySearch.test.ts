import { describe, expect, it, vi } from 'vitest';
import type { ApiIndexEntry } from './apiIndex';
import {
    createApiSearcher,
    fetchCatalogSpec,
    RegistryFetchError,
    searchApiIndex,
    tokenize
} from './registrySearch';

function entry(id: string, title: string, extra: Partial<ApiIndexEntry> = {}): ApiIndexEntry {
    return {
        id,
        title,
        description: '',
        categories: [],
        specUrl: `https://api.apis.guru/v2/specs/${id.replace(':', '/')}/1.0.0/openapi.json`,
        openapiVersion: '3.0.0',
        supported: true,
        updated: '2023-01-01',
        ...extra
    };
}

const CATALOG: ApiIndexEntry[] = [
    entry('visualcrossing.com:weather', 'Visual Crossing Weather API', { description: 'Weather forecast and history.', categories: ['location'] }),
    entry('amazonaws.com:forecast', 'Amazon Forecast Service', { description: 'Time-series forecasting.', categories: ['cloud'] }),
    entry('nexmo.com:sms', 'SMS API', { description: 'Send and receive SMS messages.', categories: ['telecom', 'messaging'] }),
    entry('thesmsworks.co.uk', 'The SMS Works API', { openapiVersion: '2.0', supported: false, categories: ['telecom'] }),
    entry('googleapis.com:calendar', 'Calendar API', { description: 'Manipulates events and other calendar data.' }),
    entry('github.com', 'GitHub v3 REST API', { description: 'Repositories, issues and pull requests.', categories: ['developer_tools'] })
];

describe('tokenize', () => {
    it('lower-cases, splits on punctuation, and drops stop words and one-letter fragments', () => {
        expect(tokenize('Send an SMS to my phone, via API!')).toEqual(['send', 'sms', 'phone', 'via']);
    });

    it('splits an APIs.guru id into its words', () => {
        expect(tokenize('visualcrossing.com:weather')).toEqual(['visualcrossing', 'com', 'weather']);
    });
});

describe('createApiSearcher', () => {
    const searcher = createApiSearcher(CATALOG);

    it('puts the API whose title names the query first', () => {
        expect(searcher.search('weather forecast')[0].entry.id).toBe('visualcrossing.com:weather');
    });

    it('ranks a title match above a description-only match', () => {
        const ids = searcher.search('forecast').map(r => r.entry.id);
        expect(ids.indexOf('amazonaws.com:forecast')).toBeLessThan(ids.indexOf('visualcrossing.com:weather'));
    });

    it('prefers an entry matching every query word over one matching a single word', () => {
        expect(searcher.search('send sms')[0].entry.id).toBe('nexmo.com:sms');
    });

    it('matches a prefix of three or more letters', () => {
        expect(searcher.search('calend')[0].entry.id).toBe('googleapis.com:calendar');
    });

    it('matches on the provider id', () => {
        expect(searcher.search('github')[0].entry.id).toBe('github.com');
    });

    it('keeps unsupported entries in the results, below an equal-scoring supported one', () => {
        const ids = searcher.search('sms').map(r => r.entry.id);
        expect(ids).toContain('thesmsworks.co.uk');
        expect(ids.indexOf('nexmo.com:sms')).toBeLessThan(ids.indexOf('thesmsworks.co.uk'));
    });

    it('returns nothing for a query of only stop words, or nothing that matches', () => {
        expect(searcher.search('the api for a')).toEqual([]);
        expect(searcher.search('zzzqqq')).toEqual([]);
    });

    it('respects the limit', () => {
        expect(searcher.search('sms')).toHaveLength(2);
        expect(searcher.search('sms', 1)).toHaveLength(1);
    });

    it('orders ties deterministically', () => {
        const a = searchApiIndex(CATALOG, 'sms').map(r => r.entry.id);
        const b = searchApiIndex([...CATALOG].reverse(), 'sms').map(r => r.entry.id);
        expect(a).toEqual(b);
    });
});

// ============================================
// FETCH
// ============================================

function response(body: string, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    return new Response(body, { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...init.headers } });
}

const WEATHER = CATALOG[0];

describe('APIs that compile to nothing', () => {
    it('rank after a usable API that matches as well, and still show', () => {
        const catalog = [
            entry('dead.example', 'Weather API', { operations: 0, blocker: 'It needs a sign-in Flyspace does not support yet (OAuth, or several keys at once)' }),
            entry('live.example', 'Weather API', { operations: 5 })
        ];
        expect(searchApiIndex(catalog, 'weather').map(hit => hit.entry.id)).toEqual(['live.example', 'dead.example']);
    });

    it('still lead when they match far better', () => {
        const catalog = [
            entry('gmail.example', 'Gmail API', { description: 'gmail mail inbox', operations: 0 }),
            entry('mailer.example', 'Bulk Sender', { description: 'mail', operations: 5 })
        ];
        expect(searchApiIndex(catalog, 'gmail inbox')[0].entry.id).toBe('gmail.example');
    });
});

describe('fetchCatalogSpec', () => {
    it('fetches the spec with no credentials, no referrer and no redirects', async () => {
        const fetchImpl = vi.fn(async () => response('{"openapi":"3.0.0"}'));
        await expect(fetchCatalogSpec(WEATHER, { fetchImpl })).resolves.toEqual({ openapi: '3.0.0' });

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(WEATHER.specUrl);
        expect(init.credentials).toBe('omit');
        expect(init.redirect).toBe('error');
        expect(init.referrerPolicy).toBe('no-referrer');
    });

    it('refuses a Swagger 2.0 entry before any request', async () => {
        const fetchImpl = vi.fn();
        await expect(fetchCatalogSpec(CATALOG[3], { fetchImpl })).rejects.toMatchObject({ code: 'unsupported_version' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses an entry whose spec URL was changed to leave the catalog', async () => {
        const fetchImpl = vi.fn();
        const tampered = { ...WEATHER, specUrl: 'https://evil.example/spec.json' };
        await expect(fetchCatalogSpec(tampered, { fetchImpl })).rejects.toMatchObject({ code: 'not_catalog_url' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses a declared size over the limit without reading the body', async () => {
        const fetchImpl = vi.fn(async () => response('{}', { headers: { 'content-length': '999999' } }));
        await expect(fetchCatalogSpec(WEATHER, { fetchImpl, maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    });

    it('stops reading a body that grows past the limit', async () => {
        const fetchImpl = vi.fn(async () => response(`{"padding":"${'x'.repeat(5000)}"}`));
        await expect(fetchCatalogSpec(WEATHER, { fetchImpl, maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
    });

    it('reports a non-2xx status', async () => {
        const fetchImpl = vi.fn(async () => response('not found', { status: 404 }));
        await expect(fetchCatalogSpec(WEATHER, { fetchImpl })).rejects.toMatchObject({ code: 'status' });
    });

    it('reports invalid JSON without quoting the document', async () => {
        const fetchImpl = vi.fn(async () => response('{"secret-looking": broken'));
        const error: unknown = await fetchCatalogSpec(WEATHER, { fetchImpl }).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(RegistryFetchError);
        const fetchError = error as RegistryFetchError;
        expect(fetchError.code).toBe('not_json');
        expect(fetchError.message).not.toContain('secret-looking');
    });

    it('reports a network failure as unreachable', async () => {
        const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
        await expect(fetchCatalogSpec(WEATHER, { fetchImpl })).rejects.toMatchObject({ code: 'unreachable' });
    });

    it('reports a timeout', async () => {
        const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })));
        }));
        await expect(fetchCatalogSpec(WEATHER, { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 10 }))
            .rejects.toMatchObject({ code: 'timeout' });
    });
});
