import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { runStream, runComplete, providerStreams } from './llm.adapters';

describe('Ollama HTTP boundary', () => {
    let sourceServer: Server;
    let redirectTarget: Server;
    let sourceUrl: string;
    let redirectTargetHits = 0;
    let redirectNext = false;
    let sourceClosed: Promise<void>;
    const previousMode = process.env.OMNI_DEPLOYMENT_MODE;
    const previousBaseUrl = process.env.OLLAMA_BASE_URL;

    beforeAll(async () => {
        process.env.OMNI_DEPLOYMENT_MODE = 'local';
        delete process.env.OLLAMA_BASE_URL;
        redirectTarget = createServer((_request, response) => {
            redirectTargetHits++;
            response.end('should not follow');
        });
        await new Promise<void>(resolve => redirectTarget.listen(0, '127.0.0.1', resolve));
        const targetAddress = redirectTarget.address();
        if (!targetAddress || typeof targetAddress === 'string') throw new Error('redirect target failed to bind');
        const targetUrl = `http://127.0.0.1:${targetAddress.port}/target`;

        sourceServer = createServer((request, response) => {
            if (redirectNext) {
                redirectNext = false;
                response.writeHead(302, { location: targetUrl });
                response.end();
                return;
            }
            sourceClosed = new Promise(resolve => response.on('close', resolve));
            response.writeHead(200, { 'content-type': 'application/x-ndjson' });
            response.write('{"message":{"content":"first"},"done":false}\n');
            // Keep the upstream open so test cancellation reaches this socket.
        });
        await new Promise<void>(resolve => sourceServer.listen(0, '127.0.0.1', resolve));
        const sourceAddress = sourceServer.address();
        if (!sourceAddress || typeof sourceAddress === 'string') throw new Error('source server failed to bind');
        sourceUrl = `http://127.0.0.1:${sourceAddress.port}`;
    });

    afterAll(async () => {
        await Promise.all([
            new Promise<void>((resolve, reject) => sourceServer.close(error => error ? reject(error) : resolve())),
            new Promise<void>((resolve, reject) => redirectTarget.close(error => error ? reject(error) : resolve()))
        ]);
        if (previousMode === undefined) delete process.env.OMNI_DEPLOYMENT_MODE;
        else process.env.OMNI_DEPLOYMENT_MODE = previousMode;
        if (previousBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
        else process.env.OLLAMA_BASE_URL = previousBaseUrl;
    });

    it('aborting an actual streaming fetch closes its upstream connection', async () => {
        const abort = new AbortController();
        const stream = await runStream({
            provider: 'local', model: 'tinyllama', messages: [{ role: 'user', content: 'hi' }],
            baseUrl: sourceUrl, signal: abort.signal
        });
        const reader = stream.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe('first');
        abort.abort();
        await expect(reader.read()).rejects.toThrow();
        await Promise.race([sourceClosed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream stayed open')), 1000))]);
    });

    it('rejects redirects without contacting their destination', async () => {
        redirectNext = true;
        await expect(runComplete({
            provider: 'local', model: 'tinyllama', messages: [], baseUrl: sourceUrl
        })).rejects.toThrow();
        expect(redirectTargetHits).toBe(0);
    });

    it('uses only the configured hosted Ollama endpoint, never a request override', async () => {
        process.env.OMNI_DEPLOYMENT_MODE = 'hosted';
        process.env.OLLAMA_BASE_URL = 'https://ollama.example.test';
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: { content: 'ok' } }), {
            status: 200, headers: { 'content-type': 'application/json' }
        }));
        try {
            await runComplete({
                provider: 'local', model: 'tinyllama', messages: [], baseUrl: 'http://127.0.0.1:11434'
            });
            expect(fetch.mock.calls[0][0]).toBe('https://ollama.example.test/api/chat');
            expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
        } finally {
            fetch.mockRestore();
            process.env.OMNI_DEPLOYMENT_MODE = 'local';
            delete process.env.OLLAMA_BASE_URL;
        }
    });
});

describe('providerStreams', () => {
    it('is true only for the local provider, which has a streaming path', () => {
        expect(providerStreams('local')).toBe(true);
        expect(providerStreams('anthropic')).toBe(false);
        expect(providerStreams('google')).toBe(false);
    });

    it('a cloud runStream hands the completed answer over as one chunk', async () => {
        const previousKey = process.env.ANTHROPIC_API_KEY;
        process.env.ANTHROPIC_API_KEY = 'test-key';
        const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            content: [{ text: 'whole answer' }], usage: { input_tokens: 1, output_tokens: 2 }, stop_reason: 'end_turn'
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        try {
            const stream = await runStream({
                provider: 'anthropic', model: 'm', messages: [{ role: 'user', content: 'hi' }]
            });
            const reader = stream.getReader();
            const chunks: string[] = [];
            for (let next = await reader.read(); !next.done; next = await reader.read()) {
                chunks.push(new TextDecoder().decode(next.value));
            }
            expect(chunks).toEqual(['whole answer']);
            expect(fetch).toHaveBeenCalledOnce();
        } finally {
            fetch.mockRestore();
            if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = previousKey;
        }
    });
});
