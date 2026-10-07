// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiSearch } from './ApiSearch';
import { CapabilityInstall } from './CapabilityInstall';
import type { ApiIndex, ApiIndexEntry } from '@/core/capabilities/apiIndex';
import { clearCapabilities, listCapabilities } from '@/core/capabilities/registry';
import { capabilitySecrets } from '@/core/capabilities/secrets';

function entry(id: string, title: string, extra: Partial<ApiIndexEntry> = {}): ApiIndexEntry {
    return {
        id, title, description: '', categories: [],
        specUrl: `https://api.apis.guru/v2/specs/${id.replace(':', '/')}/1.0.0/openapi.json`,
        openapiVersion: '3.0.0', supported: true, updated: '2023-04-21', ...extra
    };
}

const INDEX: ApiIndex = {
    format: 'omni-api-index',
    version: 1,
    source: { url: 'https://api.apis.guru/v2/list.json', license: 'CC0-1.0', etag: null, lastModified: 'Mon, 18 Aug 2025 10:53:40 GMT' },
    builtAt: '2026-10-07T00:00:00.000Z',
    entries: [
        entry('visualcrossing.com:weather', 'Visual Crossing Weather API', { description: 'Weather forecast', categories: ['location'] }),
        entry('nexmo.com:sms', 'SMS API', { description: 'Send SMS messages', categories: ['telecom'] }),
        entry('thesmsworks.co.uk', 'The SMS Works API', { openapiVersion: '2.0', supported: false }),
        entry('nytimes.com:archive', 'Archive API', { description: 'is it going to rain tomorrow headlines' })
    ]
};

const WEATHER_SPEC = {
    openapi: '3.0.0',
    info: { title: 'Weather', version: '1' },
    servers: [{ url: 'https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services' }],
    paths: { '/timeline': { get: { operationId: 'timeline', summary: 'Forecast timeline', responses: { '200': { description: 'ok' } } } } }
};

interface Call { url: string; init?: RequestInit }
let calls: Call[];

/** Serve the index, the weather spec and (optionally) a JEV answer; record every request. */
function serve(routes: { intent?: unknown; spec?: unknown; indexStatus?: number } = {}) {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === '/api-index.json') {
            return routes.indexStatus ? new Response('', { status: routes.indexStatus }) : new Response(JSON.stringify(INDEX));
        }
        if (url === '/api/registry-intent') {
            return routes.intent ? new Response(JSON.stringify(routes.intent)) : new Response('{}', { status: 503 });
        }
        if (url.startsWith('https://api.apis.guru/')) return new Response(JSON.stringify(routes.spec ?? WEATHER_SPEC));
        return new Response('not found', { status: 404 });
    }));
}

async function search(text: string) {
    const box = await screen.findByLabelText('Search APIs');
    fireEvent.change(box, { target: { value: text } });
    return box;
}

const resultTitles = () =>
    within(screen.getByRole('list', { name: 'API search results' }))
        .getAllByRole('listitem')
        .map(item => item.querySelector('.font-medium')?.textContent);

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    clearCapabilities();
    capabilitySecrets.clear();
});

describe('ApiSearch', () => {
    it('loads the directory and shows keyword results as you type', async () => {
        serve();
        render(<ApiSearch onSpec={() => {}} />);
        await search('weather');
        expect(resultTitles()[0]).toBe('Visual Crossing Weather API');
        expect(screen.getByText(/spec updated 2023-04-21/)).toBeTruthy();
        expect(screen.getByText(/last updated 2025-08-18/)).toBeTruthy();
    });

    it('lists a Swagger 2.0 API but offers no way to use it', async () => {
        serve();
        render(<ApiSearch onSpec={() => {}} />);
        await search('sms');
        expect(screen.getByText(/Swagger 2\.0, not supported yet/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Use The SMS Works API' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Use SMS API' })).toBeTruthy();
    });

    it('fetches the chosen spec from the catalog and hands it over', async () => {
        serve();
        const onSpec = vi.fn();
        render(<ApiSearch onSpec={onSpec} />);
        await search('weather');
        fireEvent.click(screen.getByRole('button', { name: 'Use Visual Crossing Weather API' }));
        await waitFor(() => expect(onSpec).toHaveBeenCalledTimes(1));
        expect(onSpec.mock.calls[0][0]).toEqual(WEATHER_SPEC);
        expect(onSpec.mock.calls[0][1].id).toBe('visualcrossing.com:weather');
        const specCall = calls.find(c => c.url.startsWith('https://api.apis.guru/'))!;
        expect(specCall.url).toBe(INDEX.entries[0].specUrl);
        expect(specCall.init?.credentials).toBe('omit');
    });

    it('says so when the spec cannot be fetched', async () => {
        serve();
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === '/api-index.json') return new Response(JSON.stringify(INDEX));
            return new Response('gone', { status: 404 });
        }));
        render(<ApiSearch onSpec={() => {}} />);
        await search('weather');
        fireEvent.click(screen.getByRole('button', { name: 'Use Visual Crossing Weather API' }));
        expect(await screen.findByText(/the catalog returned 404/)).toBeTruthy();
    });

    it('falls back to pasting when the directory cannot be loaded', async () => {
        serve({ indexStatus: 404 });
        render(<ApiSearch onSpec={() => {}} />);
        expect(await screen.findByText(/Paste an OpenAPI document instead/)).toBeTruthy();
    });

    it('sends nothing for meaning when the feature is off, even on Enter', async () => {
        serve({ intent: { scores: [{ id: 'weather', p: 1 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSpec={() => {}} />);
        const box = await search('is it going to rain tomorrow');
        fireEvent.submit(box.closest('form')!);
        expect(calls.some(c => c.url === '/api/registry-intent')).toBe(false);
        expect(screen.queryByText(/sent to TypeSafe/)).toBeNull();
    });

    it('with search by meaning on, discloses it, asks on Enter, and puts the intent\'s API first', async () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED', '1');
        serve({ intent: { scores: [{ id: 'weather', p: 0.97 }, { id: 'other', p: 0.03 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSpec={() => {}} />);
        const box = await search('is it going to rain tomorrow');

        // Disclosed before anything is sent; keyword alone finds the archive.
        expect(screen.getByText(/only that, is sent to TypeSafe/)).toBeTruthy();
        expect(calls.some(c => c.url === '/api/registry-intent')).toBe(false);
        expect(resultTitles()[0]).toBe('Archive API');

        await act(async () => { fireEvent.submit(box.closest('form')!); });
        await screen.findByText('Understood as: weather');
        expect(resultTitles()[0]).toBe('Visual Crossing Weather API');
        const intentCall = calls.find(c => c.url === '/api/registry-intent')!;
        expect(JSON.parse(String(intentCall.init?.body))).toEqual({ query: 'is it going to rain tomorrow' });
    });

    it('drops back to keyword order once the text changes', async () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED', '1');
        serve({ intent: { scores: [{ id: 'weather', p: 0.97 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSpec={() => {}} />);
        const box = await search('is it going to rain tomorrow');
        await act(async () => { fireEvent.submit(box.closest('form')!); });
        await screen.findByText('Understood as: weather');
        fireEvent.change(box, { target: { value: 'is it going to rain tomorrow headlines' } });
        expect(screen.queryByText('Understood as: weather')).toBeNull();
    });

    it('is never on in the public preview', async () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED', '1');
        vi.stubEnv('NEXT_PUBLIC_OMNI_PUBLIC_DEMO', '1');
        serve({ intent: { scores: [{ id: 'weather', p: 1 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSpec={() => {}} />);
        const box = await search('rain');
        fireEvent.submit(box.closest('form')!);
        expect(calls.some(c => c.url === '/api/registry-intent')).toBe(false);
    });
});

// The real Visual Crossing spec gives three operations the same summary; the
// browser smoke on 2026-10-07 showed them as three identical checkboxes.
const SAME_TITLES_SPEC = {
    openapi: '3.0.0',
    info: { title: 'Weather', version: '1' },
    servers: [{ url: 'https://weather.visualcrossing.com/rest' }],
    paths: {
        '/timeline/{location}': { get: { operationId: 'timeline', summary: 'Weather API', parameters: [{ name: 'location', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } } },
        '/forecast': { get: { operationId: 'forecast', summary: 'Weather API', responses: { '200': { description: 'ok' } } } }
    }
};

describe('CapabilityInstall with search', () => {
    it('tells same-titled operations apart by method and path', async () => {
        serve({ spec: SAME_TITLES_SPEC });
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        await search('weather');
        fireEvent.click(screen.getByRole('button', { name: 'Use Visual Crossing Weather API' }));

        expect(await screen.findByLabelText('Weather API (GET /timeline/{location})')).toBeTruthy();
        expect(screen.getByLabelText('Weather API (GET /forecast)')).toBeTruthy();
        expect(screen.getByText('GET /timeline/{location}')).toBeTruthy();
    });

    it('moves focus to the review after a pick, so it is not left below the results', async () => {
        serve();
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        await search('weather');
        fireEvent.click(screen.getByRole('button', { name: 'Use Visual Crossing Weather API' }));
        const review = await screen.findByText(/^Review Visual Crossing Weather API before installing/);
        await waitFor(() => expect(document.activeElement).toBe(review));
    });

    it('goes from a search to the review to an installed capability, recording where the spec came from', async () => {
        serve();
        render(<CapabilityInstall />);
        fireEvent.click(screen.getByRole('button', { name: 'Bring an API' }));
        await search('weather');
        fireEvent.click(screen.getByRole('button', { name: 'Use Visual Crossing Weather API' }));

        // The review: the operation, and the origin a request goes to.
        expect(await screen.findByLabelText('Forecast timeline')).toBeTruthy();
        expect(screen.getByText('https://weather.visualcrossing.com')).toBeTruthy();
        expect(screen.getByText(/Review Visual Crossing Weather API before installing: spec updated 2023-04-21/)).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Install selected' }));
        const installed = listCapabilities().find(m => m.source.operationId === 'timeline');
        expect(installed?.approval).toBe('auto');
        expect(installed?.source.locator).toBe(INDEX.entries[0].specUrl);
    });
});
