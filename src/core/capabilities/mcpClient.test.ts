import { describe, it, expect, vi } from 'vitest';
import { createMcpHttpTransport } from './mcpClient';

describe('MCP streamable HTTP client', () => {
    it('initializes a session and calls the tool', async () => {
        const calls: Array<{ url: string; body: unknown; session?: string }> = [];
        const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body)) as { method?: string };
            const headers = new Headers(init?.headers);
            calls.push({ url: String(url), body, session: headers.get('mcp-session-id') ?? undefined });
            if (body.method === 'initialize') {
                return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
                    status: 200,
                    headers: { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' }
                });
            }
            if (body.method === 'notifications/initialized') {
                return new Response('', { status: 202 });
            }
            return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: 2,
                result: { structuredContent: { ok: true } }
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        });

        const transport = createMcpHttpTransport({
            url: 'https://mcp.example.test/rpc',
            fetchImpl: fetchImpl as typeof fetch
        });
        const value = await transport.call('board', 'list', { limit: 1 });
        expect(value).toEqual({ ok: true });
        expect(calls.map(call => (call.body as { method?: string }).method)).toEqual([
            'initialize',
            'notifications/initialized',
            'tools/call'
        ]);
        expect(calls[2].session).toBe('sess-1');
    });
});
