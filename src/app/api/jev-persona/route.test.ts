import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const URL = 'https://omni.syberlabs.io/api/jev-persona';
const savedEnv = {
    OMNI_JEV_ENABLED: process.env.OMNI_JEV_ENABLED,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    DECISION_PROVIDER: process.env.DECISION_PROVIDER,
    KEV_API_KEY: process.env.KEV_API_KEY,
    KEV_BASE_URL: process.env.KEV_BASE_URL,
    KEV_MODEL: process.env.KEV_MODEL,
    KEV_REVISION: process.env.KEV_REVISION,
    OMNI_KEV_ENABLED: process.env.OMNI_KEV_ENABLED
};
const REVISION = 'a'.repeat(40);

function request(question: unknown, headers: Record<string, string> = {}, signal?: AbortSignal) {
    return new NextRequest(URL, {
        method: 'POST',
        headers: {
            origin: 'https://omni.syberlabs.io',
            'content-type': 'application/json',
            ...headers
        },
        body: JSON.stringify({ question }),
        signal
    });
}

beforeEach(() => {
    process.env.OMNI_KEV_ENABLED = '1';
    delete process.env.DECISION_PROVIDER;
    process.env.KEV_API_KEY = 'private-test-key';
    process.env.KEV_BASE_URL = 'https://kev.example';
    process.env.KEV_REVISION = REVISION;
    delete process.env.KEV_MODEL;
});

afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[key as keyof typeof savedEnv];
        else process.env[key as keyof typeof savedEnv] = value;
    }
    vi.unstubAllGlobals();
});

describe('POST /api/jev-persona', () => {
    it('fails closed without an enabled feature flag or key', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        delete process.env.OMNI_KEV_ENABLED;
        process.env.OMNI_JEV_ENABLED = '1';
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.OMNI_KEV_ENABLED = '1';
        delete process.env.KEV_API_KEY;
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.KEV_API_KEY = 'private-test-key';
        delete process.env.KEV_REVISION;
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.KEV_REVISION = REVISION;
        process.env.KEV_BASE_URL = 'http://remote.example';
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.KEV_BASE_URL = 'http://localhost:8009';
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.KEV_BASE_URL = 'https://kev.example';
        process.env.KEV_MODEL = 'unapproved-model';
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.KEV_MODEL = 'kev-latest';
        process.env.KEV_REVISION = 'not-a-commit';
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.KEV_REVISION = REVISION;
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects cross-origin, wrong content type, and oversized questions before spending', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect((await POST(request('Plan a launch', { origin: 'https://evil.example' }))).status).toBe(403);
        expect((await POST(request('Plan a launch', { 'content-type': 'text/plain' }))).status).toBe(415);
        expect((await POST(request('x'.repeat(501)))).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends only the user question to Kev and returns a validated persona with revision', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
            model: 'kev-latest',
            answers: { persona: { type: 'choice', choice: 'strategist' } }
        }, { headers: { 'X-Kev-Revision': REVISION } }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await POST(request('  How should we launch?  '));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ persona: 'strategist', provider: 'kev', model: 'kev-latest', revision: REVISION });
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        if (!init) throw new Error('Expected request options');
        expect(url).toBe('https://kev.example/v1/systemone');
        expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer private-test-key' }));
        expect(init.redirect).toBe('error');
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe('kev-latest');
        expect(body.state).toBe('How should we launch?');
        expect(JSON.stringify(body)).not.toContain('private-test-key');
    });

    it('rejects a mismatched Kev model or persona', async () => {
        for (const result of [
            { model: 'other/model', answers: { persona: { type: 'choice', choice: 'strategist' } } },
            { model: 'kev-latest', answers: { persona: { type: 'choice', choice: 'admin' } } }
        ]) {
            vi.stubGlobal('fetch', vi.fn(async () => Response.json(result, { headers: { 'X-Kev-Revision': REVISION } })));
            const response = await POST(request('Plan a launch'));
            expect(response.status).toBe(502);
            expect(JSON.stringify(await response.json())).not.toContain('private-test-key');
        }
    });

    it('fails closed on rejected upstream, malformed response, and timeout', async () => {
        for (const upstream of [
            vi.fn(async () => new Response('unauthorized', { status: 401 })),
            vi.fn(async () => Response.json({ model: 'kev-latest', answers: {} }, { headers: { 'X-Kev-Revision': REVISION } })),
            vi.fn(async () => { throw new DOMException('Timed out', 'TimeoutError'); })
        ]) {
            vi.stubGlobal('fetch', upstream);
            const response = await POST(request('Plan a launch'));
            expect(response.status).toBe(502);
            expect(await response.json()).toEqual({ error: 'Persona suggestion failed.' });
        }
    });

    it('rejects missing or mismatched serving revision before reading an answer', async () => {
        for (const headers of [new Headers(), new Headers({ 'X-Kev-Revision': 'b'.repeat(40) })]) {
            vi.stubGlobal('fetch', vi.fn(async () => Response.json({
                model: 'kev-latest', answers: { persona: { type: 'choice', choice: 'strategist' } }
            }, { headers })));
            expect((await POST(request('Plan a launch'))).status).toBe(502);
        }
    });

    it('keeps the eight-second deadline and propagates caller cancellation', async () => {
        const timeout = AbortSignal.timeout;
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => timeout(ms));
        const controller = new AbortController();
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            expect(init?.signal?.aborted).toBe(false);
            controller.abort();
            expect(init?.signal?.aborted).toBe(true);
            throw new DOMException('Aborted', 'AbortError');
        });
        vi.stubGlobal('fetch', fetchMock);
        expect((await POST(request('Plan a launch', {}, controller.signal))).status).toBe(502);
        expect(timeoutSpy).toHaveBeenCalledWith(8000);
        timeoutSpy.mockRestore();
    });

    it('uses Jev only with the explicit rollback setting', async () => {
        process.env.DECISION_PROVIDER = 'jev';
        process.env.OMNI_JEV_ENABLED = '1';
        process.env.OPENROUTER_API_KEY = 'jev-test-key';
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
            provider: 'TypeSafe', model: 'typesafe/jev-1.13',
            answers: { persona: { type: 'choice', choice: 'analyst' } }
        }));
        vi.stubGlobal('fetch', fetchMock);
        const response = await POST(request('Review the evidence'));
        expect(await response.json()).toEqual({ persona: 'analyst', provider: 'jev', model: 'typesafe/jev-1.13' });
        expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions');
        expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).state).toEqual({ question: 'Review the evidence' });
    });
});
