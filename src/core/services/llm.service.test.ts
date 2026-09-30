// ============================================
// LLM SERVICE — the client proxy contract.
//
// Every call goes to /api/llm. The browser never holds a provider key, and
// the JSON body must not grow an apiKey field — that is how a key would
// leak into the client bundle's request path.
// ============================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLLMService, getLLMService } from './llm.service';
import { LLM_DEFAULTS } from '@/core/schemas/mind.schema';

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

beforeEach(() => {
    globalThis.fetch = vi.fn();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function postedBody(): Record<string, unknown> {
    const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
    return JSON.parse(String(init.body));
}

describe('LLMService.isAvailable', () => {
    it('pings /api/llm with the provider and no key', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ available: true }));
        const llm = createLLMService(LLM_DEFAULTS.local);

        await expect(llm.isAvailable()).resolves.toBe(true);

        expect(globalThis.fetch).toHaveBeenCalledWith(
            '/api/llm',
            expect.objectContaining({ method: 'POST' })
        );
        const body = postedBody();
        expect(body).toMatchObject({ mode: 'ping', provider: 'local' });
        expect(body).not.toHaveProperty('apiKey');
        expect(JSON.stringify(body)).not.toMatch(/key/i);
    });

    it('returns false when the probe cannot reach the server', async () => {
        vi.mocked(globalThis.fetch).mockRejectedValue(new Error('network down'));
        await expect(createLLMService(LLM_DEFAULTS.local).isAvailable()).resolves.toBe(false);
    });
});

describe('LLMService.complete', () => {
    it('posts messages to /api/llm without an apiKey field', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue(
            jsonResponse({ content: 'hello', tokensUsed: 3, finishReason: 'stop' })
        );
        const llm = createLLMService(LLM_DEFAULTS.anthropic);
        const result = await llm.complete([{ role: 'user', content: 'Hi' }]);

        expect(result.content).toBe('hello');
        expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe('/api/llm');
        const body = postedBody();
        expect(body.provider).toBe('anthropic');
        expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
        expect(body).not.toHaveProperty('apiKey');
        expect(body).not.toHaveProperty('stream');
    });

    it('throws the server error body, not a status-only shrug', async () => {
        vi.mocked(globalThis.fetch).mockResolvedValue(
            jsonResponse({ error: 'anthropic is not configured on the server.' }, 503)
        );
        await expect(
            createLLMService(LLM_DEFAULTS.anthropic).complete([{ role: 'user', content: 'Hi' }])
        ).rejects.toThrow('anthropic is not configured on the server.');
    });

    it('passes the caller cancellation signal to complete fetch', async () => {
        const controller = new AbortController();
        vi.mocked(globalThis.fetch).mockResolvedValue(jsonResponse({ content: 'ok' }));
        await createLLMService(LLM_DEFAULTS.local).complete(
            [{ role: 'user', content: 'Hi' }], { signal: controller.signal }
        );
        expect((vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit).signal)
            .toBe(controller.signal);
    });
});

describe('LLMService.stream', () => {
    it('yields decoded chunks from the response body', async () => {
        const encoder = new TextEncoder();
        const chunks = ['Hello ', 'world'];
        let i = 0;
        vi.mocked(globalThis.fetch).mockResolvedValue(
            new Response(
                new ReadableStream({
                    pull(controller) {
                        if (i >= chunks.length) {
                            controller.close();
                            return;
                        }
                        controller.enqueue(encoder.encode(chunks[i++]));
                    }
                }),
                { status: 200 }
            )
        );

        const llm = createLLMService(LLM_DEFAULTS.local);
        const got: string[] = [];
        for await (const chunk of llm.stream([{ role: 'user', content: 'Hi' }])) {
            got.push(chunk);
        }
        expect(got.join('')).toBe('Hello world');
        expect(postedBody().stream).toBe(true);
        expect(postedBody()).not.toHaveProperty('apiKey');
        expect(postedBody()).not.toHaveProperty('signal');
    });

    it('passes AbortSignal to fetch, not the JSON body', async () => {
        const controller = new AbortController();
        vi.mocked(globalThis.fetch).mockResolvedValue(
            new Response('x', { status: 200 })
        );
        const llm = createLLMService(LLM_DEFAULTS.local);
        const gen = llm.stream([{ role: 'user', content: 'Hi' }], { signal: controller.signal });
        await gen.next();

        const init = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
        expect(init.signal).toBe(controller.signal);
        expect(JSON.parse(String(init.body))).not.toHaveProperty('signal');
    });

    it('cancels the response reader when the consumer stops early', async () => {
        let canceled = false;
        vi.mocked(globalThis.fetch).mockResolvedValue(new Response(new ReadableStream({
            pull(controller) { controller.enqueue(new TextEncoder().encode('first')); },
            cancel() { canceled = true; }
        }), { status: 200 }));
        const gen = createLLMService(LLM_DEFAULTS.local).stream([{ role: 'user', content: 'Hi' }]);
        await gen.next();
        await gen.return(undefined);
        expect(canceled).toBe(true);
    });
});

describe('getLLMService', () => {
    it('reuses the instance for the same provider', () => {
        const a = getLLMService(LLM_DEFAULTS.local);
        const b = getLLMService(LLM_DEFAULTS.local);
        expect(a).toBe(b);
    });
});
