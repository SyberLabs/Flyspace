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
        entry('nytimes.com:archive', 'Archive API', { description: 'is it going to rain tomorrow headlines' }),
        entry('googleapis.com:calendar', 'Calendar API', { description: 'calendar events', operations: 0, blocker: 'It needs a sign-in Flyspace does not support yet (OAuth, or several keys at once)' }),
        entry('1password.com:events', 'Events API', { description: 'calendar events audit', operations: 3, credential: 'key' }),
        entry('holidays.example', 'Holiday Dates', { description: 'public holiday dates', operations: 2, credential: 'none' }),
        entry('holidays-pro.example', 'Holiday Planner Pro', { description: 'holiday planner', operations: 5, credential: 'key' })
    ]
};

interface Call { url: string; init?: RequestInit }
let calls: Call[];

function serve(routes: { indexStatus?: number } = {}) {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === '/api-index.json') {
            return routes.indexStatus ? new Response('', { status: routes.indexStatus }) : new Response(JSON.stringify(INDEX));
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

    it('says how much an API gives, and disables one that gives nothing, with the reason', async () => {
        serve();
        const onSelect = vi.fn();
        render(<ApiSearch onSelect={onSelect} />);
        await search('calendar events');
        expect(resultNames().slice(0, 2)).toEqual(['Review Events API', 'Calendar API (nothing usable yet)']);
        expect(screen.getByText('· 3 operations')).toBeTruthy();
        expect(screen.getByText('Nothing usable yet: It needs a sign-in Flyspace does not support yet (OAuth, or several keys at once)')).toBeTruthy();
        const dead = screen.getByRole('button', { name: 'Calendar API (nothing usable yet)' }) as HTMLButtonElement;
        expect(dead.disabled).toBe(true);
        fireEvent.click(dead);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('says what each result needs to run, and filters to the ones that need no key', async () => {
        serve();
        render(<ApiSearch onSelect={() => {}} />);
        await search('holiday');
        expect(screen.getByRole('button', { name: 'Review Holiday Planner Pro' }).textContent).toContain('needs a key');
        expect(screen.getByRole('button', { name: 'Review Holiday Dates' }).textContent).toContain('no key');

        fireEvent.click(screen.getByRole('button', { name: 'No key needed' }));
        expect(screen.getByRole('button', { name: 'No key needed' }).getAttribute('aria-pressed')).toBe('true');
        expect(resultNames()).toEqual(['Review Holiday Dates']);
    });

    it('falls back to pasting when the directory cannot be loaded', async () => {
        serve({ indexStatus: 404 });
        render(<ApiSearch onSelect={() => {}} />);
        expect(await screen.findByText(/Paste an OpenAPI document instead/)).toBeTruthy();
    });

    it('searches by keyword only: Enter asks nothing of a server', async () => {
        serve();
        render(<ApiSearch onSelect={() => {}} />);
        const box = await search('is it going to rain tomorrow');
        expect(resultNames()[0]).toBe('Review Archive API');
        fireEvent.submit(box.closest('form')!);
        expect(calls.map(c => c.url)).toEqual(['/api-index.json']);
        expect(screen.queryByText(/sent to TypeSafe/)).toBeNull();
    });
});
