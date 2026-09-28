import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { pinnedFetch } from './pinnedFetch';

describe('pinnedFetch', () => {
    it('connects to the approved address and sends the original host', async () => {
        const seen: { host?: string; url?: string } = {};
        const server = http.createServer((req, res) => {
            seen.host = req.headers.host;
            seen.url = req.url;
            res.end('["pinned"]');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('no port');
        try {
            const response = await pinnedFetch({
                url: new URL(`http://board.example.test:${address.port}/items`),
                address: '127.0.0.1',
                method: 'GET',
                headers: { accept: 'application/json' },
                maxBytes: 1000
            });
            expect(response.status).toBe(200);
            expect(response.text).toBe('["pinned"]');
            expect(seen.host).toBe(`board.example.test:${address.port}`);
            expect(seen.url).toBe('/items');
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});
