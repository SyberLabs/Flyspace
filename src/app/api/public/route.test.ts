import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

const BODY_MARKER = 'UPSTREAM-BODY-MUST-NOT-BE-LOGGED';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function request(query: string) {
    return new NextRequest(`http://localhost/api/public?${query}`);
}

async function failureOf(response: Response) {
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.success).toBeUndefined();
    expect(typeof body.error.message).toBe('string');
    return body.error.code as string;
}

describe('GET /api/public', () => {
    it('refuses an unknown provider without calling upstream', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const response = await GET(request('provider=fred'));
        expect(response.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns the upstream JSON verbatim with no-store on the happy path', async () => {
        const upstream = { features: [{ id: 'q1' }], metadata: { count: 1 } };
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json(upstream));
        vi.stubGlobal('fetch', fetchMock);

        const response = await GET(request('provider=usgs'));

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual(upstream);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.redirect).toBe('manual');
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('aborts a slow upstream at the 8 s deadline and reports 502 upstream_timeout', async () => {
        const realTimeout = AbortSignal.timeout.bind(AbortSignal);
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(25));
        vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
            const signal = init?.signal as AbortSignal;
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })));

        expect(await failureOf(await GET(request('provider=wikipedia')))).toBe('upstream_timeout');
        expect(timeoutSpy).toHaveBeenCalledWith(8000);
        expect(JSON.stringify(warn.mock.calls)).toContain('upstream_timeout');
    });

    it('does not follow a redirect and reports it as 502 upstream_redirect', async () => {
        const fetchMock = vi.fn(async () => new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example/exfil?token=SECRET-IN-LOCATION' }
        }));
        vi.stubGlobal('fetch', fetchMock);

        expect(await failureOf(await GET(request('provider=frankfurter')))).toBe('upstream_redirect');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain('evil.example');
        expect(logged).not.toContain('SECRET-IN-LOCATION');
    });

    it('caps the upstream body at 1 MB and reports 502 upstream_too_large', async () => {
        const oversized = `["${'x'.repeat(1_000_001)}"]`;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(oversized, {
            status: 200, headers: { 'content-type': 'application/json' }
        })));

        expect(await failureOf(await GET(request('provider=crossref')))).toBe('upstream_too_large');
    });

    it('reports an upstream non-2xx as 502 upstream_status and logs the status, never the body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: BODY_MARKER }), {
            status: 403, headers: { 'content-type': 'application/json' }
        })));

        expect(await failureOf(await GET(request('provider=github')))).toBe('upstream_status');
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain('403');
        expect(logged).not.toContain(BODY_MARKER);
    });

    it('reports non-JSON upstream as 502 upstream_shape and keeps the body out of the log', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${BODY_MARKER}</html>`, {
            status: 200, headers: { 'content-type': 'text/html' }
        })));

        expect(await failureOf(await GET(request('provider=openlibrary')))).toBe('upstream_shape');
        expect(JSON.stringify(warn.mock.calls)).not.toContain(BODY_MARKER);
    });

    it('reports a network failure as 502 upstream_unreachable without echoing the error text', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('secret-in-url'); }));

        const response = await GET(request('provider=openmeteo'));
        expect(response.status).toBe(502);
        const body = await response.json();
        expect(body.error.code).toBe('upstream_unreachable');
        expect(JSON.stringify(body)).not.toContain('secret-in-url');
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-in-url');
    });
});
