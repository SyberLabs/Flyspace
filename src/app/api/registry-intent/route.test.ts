import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ classifyIntent: vi.fn() }));
vi.mock('@/core/services/server/registryIntent', () => ({ classifyIntent: mocks.classifyIntent }));

import { POST } from './route';

const ENV = ['OMNI_PUBLIC_DEMO', 'OMNI_REGISTRY_JEV_ENABLED', 'TYPESAFE_API_KEY'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    delete process.env.OMNI_PUBLIC_DEMO;
    process.env.OMNI_REGISTRY_JEV_ENABLED = '1';
    process.env.TYPESAFE_API_KEY = 'test-key';
});

afterEach(() => {
    for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    vi.clearAllMocks();
});

function post(body: unknown, origin = 'http://localhost:3000'): NextRequest {
    return new NextRequest('http://localhost:3000/api/registry-intent', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body)
    });
}

describe('/api/registry-intent', () => {
    it('is off unless explicitly enabled, even with a key', async () => {
        delete process.env.OMNI_REGISTRY_JEV_ENABLED;
        expect((await POST(post({ query: 'rain' }))).status).toBe(503);
        expect(mocks.classifyIntent).not.toHaveBeenCalled();
    });

    it('is off without a key', async () => {
        delete process.env.TYPESAFE_API_KEY;
        expect((await POST(post({ query: 'rain' }))).status).toBe(503);
        expect(mocks.classifyIntent).not.toHaveBeenCalled();
    });

    it('is always off in the public preview', async () => {
        process.env.OMNI_PUBLIC_DEMO = '1';
        expect((await POST(post({ query: 'rain' }))).status).toBe(503);
        expect(mocks.classifyIntent).not.toHaveBeenCalled();
    });

    it('refuses a cross-origin request before calling JEV', async () => {
        expect((await POST(post({ query: 'rain' }, 'https://evil.example'))).status).toBe(403);
        expect(mocks.classifyIntent).not.toHaveBeenCalled();
    });

    it('returns the scores and model', async () => {
        mocks.classifyIntent.mockResolvedValue({ ok: true, scores: [{ id: 'weather', p: 0.9 }], model: 'jev-1.13.0' });
        const response = await POST(post({ query: 'is it going to rain' }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ scores: [{ id: 'weather', p: 0.9 }], model: 'jev-1.13.0' });
        expect(mocks.classifyIntent.mock.calls[0][0]).toBe('is it going to rain');
    });

    it('answers 400 for an invalid query', async () => {
        mocks.classifyIntent.mockResolvedValue({ ok: false, failure: 'query_invalid' });
        expect((await POST(post({ query: '' }))).status).toBe(400);
    });

    it('answers 502 on an upstream failure without echoing the query', async () => {
        mocks.classifyIntent.mockResolvedValue({ ok: false, failure: 'upstream_shape' });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const response = await POST(post({ query: 'my secret plans' }));
        expect(response.status).toBe(502);
        expect(JSON.stringify(await response.json())).not.toContain('secret plans');
        expect(JSON.stringify(warn.mock.calls)).not.toContain('secret plans');
        warn.mockRestore();
    });
});
