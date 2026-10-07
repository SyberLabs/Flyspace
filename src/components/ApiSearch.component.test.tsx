// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ApiSearch } from './ApiSearch';
import type { ApiIndex, ApiIndexEntry } from '@/core/capabilities/apiIndex';

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

interface Call { url: string; init?: RequestInit }
let calls: Call[];

function serve(routes: { intent?: unknown; indexStatus?: number } = {}) {
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
        return new Response('not found', { status: 404 });
    }));
}

async function search(text: string) {
    const box = await screen.findByLabelText('Search APIs');
    await waitEnabled(box as HTMLInputElement);
    fireEvent.change(box, { target: { value: text } });
    return box;
}

async function waitEnabled(input: HTMLInputElement) {
    for (let i = 0; i < 50 && input.disabled; i++) await act(async () => { await new Promise(r => setTimeout(r, 10)); });
}

const resultNames = () =>
    within(screen.getByRole('list', { name: 'API search results' }))
        .getAllByRole('button')
        .map(button => button.getAttribute('aria-label'));

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('ApiSearch', () => {
    it('loads the directory and shows keyword results as you type', async () => {
        serve();
        render(<ApiSearch onSelect={() => {}} />);
        await search('weather');
        expect(resultNames()[0]).toBe('Review Visual Crossing Weather API');
        expect(screen.getByText('· spec 2023-04')).toBeTruthy();
        expect(screen.getByText(/updated 2025-08-18/)).toBeTruthy();
    });

    it('selects a supported result and marks it as the one under review', async () => {
        serve();
        const onSelect = vi.fn();
        const { rerender } = render(<ApiSearch onSelect={onSelect} />);
        await search('weather');
        fireEvent.click(screen.getByRole('button', { name: 'Review Visual Crossing Weather API' }));
        expect(onSelect.mock.calls[0][0].id).toBe('visualcrossing.com:weather');

        rerender(<ApiSearch onSelect={onSelect} selectedId="visualcrossing.com:weather" />);
        expect(screen.getByRole('button', { name: 'Review Visual Crossing Weather API' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('lists a Swagger 2.0 API but cannot select it', async () => {
        serve();
        const onSelect = vi.fn();
        render(<ApiSearch onSelect={onSelect} />);
        await search('sms');
        const unsupported = screen.getByRole('button', { name: 'The SMS Works API (not supported)' }) as HTMLButtonElement;
        expect(unsupported.disabled).toBe(true);
        expect(screen.getByText(/Swagger 2\.0, not supported yet/)).toBeTruthy();
        fireEvent.click(unsupported);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('falls back to pasting when the directory cannot be loaded', async () => {
        serve({ indexStatus: 404 });
        render(<ApiSearch onSelect={() => {}} />);
        expect(await screen.findByText(/Paste an OpenAPI document instead/)).toBeTruthy();
    });

    it('sends nothing for meaning when the feature is off, even on Enter', async () => {
        serve({ intent: { scores: [{ id: 'weather', p: 1 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSelect={() => {}} />);
        const box = await search('is it going to rain tomorrow');
        fireEvent.submit(box.closest('form')!);
        expect(calls.some(c => c.url === '/api/registry-intent')).toBe(false);
        expect(screen.queryByText(/sent to TypeSafe/)).toBeNull();
    });

    it('with search by meaning on, discloses it, asks on Enter, and puts the intent\'s API first', async () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED', '1');
        serve({ intent: { scores: [{ id: 'weather', p: 0.97 }, { id: 'other', p: 0.03 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSelect={() => {}} />);
        const box = await search('is it going to rain tomorrow');

        expect(screen.getByText(/only that, is sent to TypeSafe/)).toBeTruthy();
        expect(calls.some(c => c.url === '/api/registry-intent')).toBe(false);
        expect(resultNames()[0]).toBe('Review Archive API');

        await act(async () => { fireEvent.submit(box.closest('form')!); });
        await screen.findByText('Understood as: weather');
        expect(resultNames()[0]).toBe('Review Visual Crossing Weather API');
        const intentCall = calls.find(c => c.url === '/api/registry-intent')!;
        expect(JSON.parse(String(intentCall.init?.body))).toEqual({ query: 'is it going to rain tomorrow' });
    });

    it('drops back to keyword order once the text changes', async () => {
        vi.stubEnv('NEXT_PUBLIC_OMNI_REGISTRY_JEV_ENABLED', '1');
        serve({ intent: { scores: [{ id: 'weather', p: 0.97 }], model: 'jev-1.13.0' } });
        render(<ApiSearch onSelect={() => {}} />);
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
        render(<ApiSearch onSelect={() => {}} />);
        const box = await search('rain');
        fireEvent.submit(box.closest('form')!);
        expect(calls.some(c => c.url === '/api/registry-intent')).toBe(false);
    });
});
