import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const URL = 'https://omni.syberlabs.io/api/jev-persona';
const savedEnv = {
    OMNI_JEV_ENABLED: process.env.OMNI_JEV_ENABLED,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY
};

function request(question: unknown, headers: Record<string, string> = {}) {
    return new NextRequest(URL, {
        method: 'POST',
        headers: {
            origin: 'https://omni.syberlabs.io',
            'content-type': 'application/json',
            ...headers
        },
        body: JSON.stringify({ question })
    });
}

beforeEach(() => {
    process.env.OMNI_JEV_ENABLED = '1';
    process.env.OPENROUTER_API_KEY = 'private-test-key';
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
        delete process.env.OMNI_JEV_ENABLED;
        expect((await POST(request('Plan a launch'))).status).toBe(503);
        process.env.OMNI_JEV_ENABLED = '1';
        delete process.env.OPENROUTER_API_KEY;
        expect((await POST(request('Plan a launch'))).status).toBe(503);
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

    it('sends only the user question to pinned Jev and returns a validated persona', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({
            provider: 'TypeSafe',
            model: 'typesafe/jev-1.13',
            answers: { persona: { type: 'choice', choice: 'strategist' } }
        }));
        vi.stubGlobal('fetch', fetchMock);

        const response = await POST(request('  How should we launch?  '));
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({ persona: 'strategist', model: 'typesafe/jev-1.13' });
        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        if (!init) throw new Error('Expected request options');
        expect(url).toBe('https://openrouter.ai/api/alpha/decisions');
        expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer private-test-key' }));
        const body = JSON.parse(String(init.body));
        expect(body.model).toBe('typesafe/jev-1.13');
        expect(body.state).toEqual({ question: 'How should we launch?' });
        expect(JSON.stringify(body)).not.toContain('private-test-key');
    });

    it('does not trust an unexpected provider, model, or persona', async () => {
        for (const result of [
            { provider: 'Other', model: 'typesafe/jev-1.13', answers: { persona: { type: 'choice', choice: 'strategist' } } },
            { provider: 'TypeSafe', model: 'other/model', answers: { persona: { type: 'choice', choice: 'strategist' } } },
            { provider: 'TypeSafe', model: 'typesafe/jev-1.13', answers: { persona: { type: 'choice', choice: 'admin' } } }
        ]) {
            vi.stubGlobal('fetch', vi.fn(async () => Response.json(result)));
            const response = await POST(request('Plan a launch'));
            expect(response.status).toBe(502);
            expect(JSON.stringify(await response.json())).not.toContain('private-test-key');
        }
    });
});
