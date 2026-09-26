import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const originalFetch = globalThis.fetch;
const originalOllamaUrl = process.env.OLLAMA_BASE_URL;
const originalDatabaseUrl = process.env.DATABASE_URL;
const configuredUrl = 'http://127.0.0.1:11434';
const attackerUrl = 'http://169.254.169.254/latest/meta-data';

function request(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost:3000/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, baseUrl: attackerUrl })
    });
}

beforeEach(() => {
    process.env.OLLAMA_BASE_URL = configuredUrl;
    delete process.env.DATABASE_URL;
    globalThis.fetch = vi.fn();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalOllamaUrl;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('/api/llm local provider destination', () => {
    it('uses the server URL for availability probes', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue(new Response('{}'));

        const response = await POST(request({ mode: 'ping', provider: 'local' }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ available: true });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${configuredUrl}/api/tags`, expect.objectContaining({ method: 'GET' })
        );
    });

    it('uses the server URL for completions', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue(new Response(JSON.stringify({
            message: { content: 'hello' }, done: true
        })));

        const response = await POST(request({
            provider: 'local', model: 'tinyllama',
            messages: [{ role: 'user', content: 'Hi' }]
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ content: 'hello' });
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${configuredUrl}/api/chat`, expect.objectContaining({ method: 'POST' })
        );
    });

    it('uses the server URL for streams', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue(new Response(
            `${JSON.stringify({ message: { content: 'hello' } })}\n`
        ));

        const response = await POST(request({
            provider: 'local', model: 'tinyllama', stream: true,
            messages: [{ role: 'user', content: 'Hi' }]
        }));

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('hello');
        expect(globalThis.fetch).toHaveBeenCalledWith(
            `${configuredUrl}/api/chat`, expect.objectContaining({ method: 'POST' })
        );
    });
});
