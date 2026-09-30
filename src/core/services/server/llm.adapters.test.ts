import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { runStream, runComplete } from './llm.adapters';

describe('Ollama HTTP boundary', () => {
    let sourceServer: Server;
    let redirectTarget: Server;
    let redirectTargetHits = 0;
    let redirectNext = false;
    let sourceClosed: Promise<void>;
    const previousBaseUrl = process.env.OLLAMA_BASE_URL;

    beforeAll(async () => {
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
        process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${sourceAddress.port}`;
    });

    afterAll(async () => {
        await Promise.all([
            new Promise<void>((resolve, reject) => sourceServer.close(error => error ? reject(error) : resolve())),
            new Promise<void>((resolve, reject) => redirectTarget.close(error => error ? reject(error) : resolve()))
        ]);
        if (previousBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
        else process.env.OLLAMA_BASE_URL = previousBaseUrl;
    });

    it('aborting an actual streaming fetch closes its upstream connection', async () => {
        const abort = new AbortController();
        const stream = await runStream({
            provider: 'local', model: 'tinyllama', messages: [{ role: 'user', content: 'hi' }],
            signal: abort.signal
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
            provider: 'local', model: 'tinyllama', messages: []
        })).rejects.toThrow();
        expect(redirectTargetHits).toBe(0);
    });
});
