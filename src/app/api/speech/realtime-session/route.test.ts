import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { mintRealtimeTranscriptionSecret, realtimeSpeechConfigured, REALTIME_CLIENT_SECRETS_URL } from '@/core/services/server/realtimeSpeech';

const URL = 'https://omni.local/api/speech/realtime-session';
const KEY = 'sk-test-standard-key-never-in-browser';
const saved = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OMNI_SPEECH_REALTIME_ENABLED: process.env.OMNI_SPEECH_REALTIME_ENABLED,
    OMNI_PUBLIC_DEMO: process.env.OMNI_PUBLIC_DEMO
};

function post(body: unknown = { locale: 'en-US' }, headers: Record<string, string> = {}) {
    return new NextRequest(URL, {
        method: 'POST',
        headers: { origin: 'https://omni.local', 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });
}

beforeEach(() => {
    process.env.OPENAI_API_KEY = KEY;
    process.env.OMNI_SPEECH_REALTIME_ENABLED = '1';
    delete process.env.OMNI_PUBLIC_DEMO;
});

afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    vi.unstubAllGlobals();
});

describe('realtime speech configuration', () => {
    it('needs both the key and the explicit opt-in', () => {
        expect(realtimeSpeechConfigured({ OPENAI_API_KEY: KEY, OMNI_SPEECH_REALTIME_ENABLED: '1' })).toBe(true);
        expect(realtimeSpeechConfigured({ OPENAI_API_KEY: KEY })).toBe(false);
        expect(realtimeSpeechConfigured({ OMNI_SPEECH_REALTIME_ENABLED: '1' })).toBe(false);
        expect(realtimeSpeechConfigured({ OPENAI_API_KEY: '  ', OMNI_SPEECH_REALTIME_ENABLED: '1' })).toBe(false);
    });

    it('mints a transcription session with the server key and returns only the ephemeral value', async () => {
        const fetchImpl = vi.fn(async () => Response.json({ value: 'ek_minted', expires_at: 1234 }));
        const result = await mintRealtimeTranscriptionSecret({
            env: { OPENAI_API_KEY: KEY, OMNI_SPEECH_REALTIME_ENABLED: '1' },
            locale: 'en-US',
            fetchImpl: fetchImpl as unknown as typeof fetch
        });
        expect(result).toEqual({ ok: true, clientSecret: 'ek_minted', model: 'gpt-live-transcribe', expiresAt: 1234 });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(REALTIME_CLIENT_SECRETS_URL);
        expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
        expect(JSON.parse(String(init.body))).toEqual({
            session: {
                type: 'transcription',
                audio: { input: { transcription: { model: 'gpt-live-transcribe', languages: ['en'] }, turn_detection: null } }
            }
        });
    });

    it('does not call the provider when unconfigured, and hides upstream failures', async () => {
        const fetchImpl = vi.fn(async () => new Response('upstream said something with sk-leak', { status: 401 }));
        expect(await mintRealtimeTranscriptionSecret({ env: {}, fetchImpl: fetchImpl as unknown as typeof fetch }))
            .toEqual({ ok: false, status: 503, error: 'unconfigured' });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(await mintRealtimeTranscriptionSecret({ env: { OPENAI_API_KEY: KEY, OMNI_SPEECH_REALTIME_ENABLED: '1' }, fetchImpl: fetchImpl as unknown as typeof fetch }))
            .toEqual({ ok: false, status: 502, error: 'provider-error' });
    });
});

describe('/api/speech/realtime-session', () => {
    it('reports unconfigured (503) without a key, so the browser falls back', async () => {
        delete process.env.OPENAI_API_KEY;
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        const response = await POST(post());
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'unconfigured' });
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(await (await GET(new NextRequest(URL))).json()).toEqual({ configured: false });
    });

    it('mints for a same-origin request and never returns the standard key', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ value: 'ek_route' })));
        const response = await POST(post());
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        const text = await response.text();
        expect(JSON.parse(text)).toEqual({ clientSecret: 'ek_route', model: 'gpt-live-transcribe' });
        expect(text).not.toContain(KEY);
        expect(await (await GET(new NextRequest(URL))).json()).toEqual({ configured: true });
    });

    it('refuses cross-origin, wrong content type, and the public preview', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ value: 'ek_route' })));
        expect((await POST(post({}, { origin: 'https://evil.example' }))).status).toBe(403);
        expect((await POST(post({}, { 'content-type': 'text/plain' }))).status).toBe(415);
        process.env.OMNI_PUBLIC_DEMO = '1';
        expect((await POST(post())).status).toBe(503);
    });
});
