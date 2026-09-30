// @vitest-environment node
//
// Conformance fixtures. Both servers are the official SDK v2 server package
// (@modelcontextprotocol/server), bound to a loopback port in this process:
//
// - modern: createMcpHandler with legacy: 'reject', so only the 2026-07-28
//   era (server/discover) is served;
// - legacy: WebStandardStreamableHTTPServerTransport, the SDK's 2025-era
//   entry, which only answers the initialize handshake.
//
// Gap: the 2025-era fixture is the SDK's own legacy server, not an
// independent 2025-03-26 implementation, and no remote production MCP server
// was contacted. These tests show the SDK path works against both eras in
// fixtures; they are not a measurement of any deployed server.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createMcpHttpTransport, type McpSdkTransport } from './mcpClient';
import { mcpProvider } from './providers/mcpProvider';
import { admitProposal } from './admission';
import { bindMcpTransport, executeCapability, unbindMcpTransport } from './execute';
import { approveCapability, clearCapabilities } from './registry';
import { capabilitySecrets } from './secrets';
import { transportCredentialSlot } from './identity';
import type { CapabilityManifest } from './manifest';

interface Seen {
    method?: string;
    protocol?: string | null;
    apiKey?: string | null;
}

interface Fixture {
    url: string;
    seen: Seen[];
    close(): Promise<void>;
}

function registerTools(server: McpServer, era: string): McpServer {
    server.registerTool('list', {
        description: 'List board items',
        inputSchema: z.object({ limit: z.number().int().optional() }),
        outputSchema: z.object({ items: z.array(z.string()), era: z.string() }),
        annotations: { readOnlyHint: true }
    }, async ({ limit }) => {
        const items = ['alpha', 'beta', 'gamma'].slice(0, limit ?? 3);
        return { content: [{ type: 'text', text: items.join(',') }], structuredContent: { items, era } };
    });
    server.registerTool('slow', {
        inputSchema: z.object({}),
        outputSchema: z.object({ done: z.boolean() })
    }, async () => {
        await new Promise(resolve => setTimeout(resolve, 3_000));
        return { content: [{ type: 'text', text: 'late' }], structuredContent: { done: true } };
    });
    return server;
}

async function serve(handle: (request: Request) => Promise<Response>, requiredKey?: string): Promise<Fixture> {
    const seen: Seen[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
            if (typeof value === 'string') headers.set(key, value);
        }
        let method: string | undefined;
        try {
            method = body ? (JSON.parse(body.toString()) as { method?: string }).method : undefined;
        } catch {
            method = undefined;
        }
        seen.push({ method, protocol: headers.get('mcp-protocol-version'), apiKey: headers.get('x-api-key') });
        if (requiredKey && headers.get('x-api-key') !== requiredKey) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'API key is invalid' }));
            return;
        }
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        const response = await handle(new Request(`http://127.0.0.1${req.url}`, {
            method: req.method,
            headers,
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
            signal: controller.signal
        }));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body) {
            const reader = response.body.getReader();
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(value);
                }
            } catch {
                // client went away
            }
        }
        res.end();
    });
    server.on('connection', socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        url: `http://127.0.0.1:${port}/mcp`,
        seen,
        close: () => new Promise<void>(resolve => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolve());
        })
    };
}

async function modernServer(requiredKey?: string): Promise<Fixture> {
    const handler = createMcpHandler(({ era }) => registerTools(new McpServer({ name: 'board', version: '1.0.0' }), era), {
        legacy: 'reject'
    });
    return serve(request => handler.fetch(request), requiredKey);
}

async function legacyServer(): Promise<Fixture> {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => 'legacy-session' });
    await registerTools(new McpServer({ name: 'board', version: '1.0.0' }), 'legacy-only').connect(transport);
    return serve(request => transport.handleRequest(request));
}

const API_KEY_AUTH = { kind: 'apiKey' as const, in: 'header' as const, name: 'x-api-key' };

let fixtures: Fixture[] = [];
let transports: McpSdkTransport[] = [];

async function track<T extends Fixture>(fixture: Promise<T>): Promise<T> {
    const ready = await fixture;
    fixtures.push(ready);
    return ready;
}

function client(config: Parameters<typeof createMcpHttpTransport>[0]): McpSdkTransport {
    const transport = createMcpHttpTransport(config);
    transports.push(transport);
    return transport;
}

async function installFrom(
    fixture: Fixture,
    key: string,
    tool: string,
    trusted: boolean
): Promise<{ manifest: CapabilityManifest; transport: McpSdkTransport }> {
    const transport = client({ url: fixture.url, serverId: 'board' });
    const request = {
        serverId: 'board',
        auth: API_KEY_AUTH,
        lister: { listTools: (signal?: AbortSignal) => transport.listTools(signal, { headers: { 'x-api-key': key } }) }
    };
    const discovered = await mcpProvider.discover(request);
    const candidate = discovered.candidates.find(entry => entry.externalId === tool)!;
    const proposal = await mcpProvider.materialize(candidate, { request });
    const admitted = admitProposal(proposal, trusted ? { trustedEffectHints: { mcpServers: ['board'] } } : {});
    expect(admitted.errors).toEqual([]);
    bindMcpTransport('board', transport);
    return { manifest: admitted.manifest!, transport };
}

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
});

afterEach(async () => {
    unbindMcpTransport('board');
    await Promise.all(transports.map(transport => transport.close()));
    await Promise.all(fixtures.map(fixture => fixture.close()));
    fixtures = [];
    transports = [];
    clearCapabilities();
    capabilitySecrets.clear();
});

describe('MCP client over the official SDK', () => {
    it('negotiates the 2026-07-28 era with a modern server and sends configured headers', async () => {
        const fixture = await track(modernServer());
        const transport = client({ url: fixture.url, headers: { 'x-api-key': 'static-key' } });
        const value = await transport.call('board', 'list', { limit: 2 });
        expect(value).toEqual({ items: ['alpha', 'beta'], era: 'modern' });
        expect(transport.protocolEra()).toBe('modern');
        expect(fixture.seen[0].method).toBe('server/discover');
        expect(fixture.seen.every(entry => entry.apiKey === 'static-key')).toBe(true);
        expect(fixture.seen.map(entry => entry.method)).not.toContain('initialize');
        expect(fixture.seen.find(entry => entry.method === 'tools/call')?.protocol).toBe('2026-07-28');
    });

    it('falls back to the 2025 initialize handshake against a legacy-only server', async () => {
        const fixture = await track(legacyServer());
        const transport = client({ url: fixture.url });
        const value = await transport.call('board', 'list', {});
        expect(value).toEqual({ items: ['alpha', 'beta', 'gamma'], era: 'legacy-only' });
        expect(transport.protocolEra()).toBe('legacy');
        const methods = fixture.seen.map(entry => entry.method);
        expect(methods.indexOf('server/discover')).toBeLessThan(methods.indexOf('initialize'));
        const call = fixture.seen.find(entry => entry.method === 'tools/call');
        expect(call?.protocol).toMatch(/^2025-/);
    });

    it('a pinned 2026 client refuses a legacy-only server instead of downgrading', async () => {
        const fixture = await track(legacyServer());
        const transport = client({ url: fixture.url, versionNegotiation: { pin: '2026-07-28' } });
        await expect(transport.call('board', 'list', {})).rejects.toThrow(/negotiation/i);
        expect(fixture.seen.map(entry => entry.method)).not.toContain('tools/call');
    });

    it('opens one session when two calls for the same header key start together', async () => {
        const fixture = await track(modernServer());
        const transport = client({ url: fixture.url, headers: { 'x-api-key': 'first' } });
        await transport.call('board', 'list', { limit: 1 });

        let releaseClose: () => void = () => {};
        const closeGate = new Promise<void>(resolve => { releaseClose = resolve; });
        let markCloseStarted: () => void = () => {};
        const closeStarted = new Promise<void>(resolve => { markCloseStarted = resolve; });
        let connects = 0;
        const originalClose = Client.prototype.close;
        const originalConnect = Client.prototype.connect;
        const closeSpy = vi.spyOn(Client.prototype, 'close').mockImplementation(function (this: Client) {
            markCloseStarted();
            return closeGate.then(() => originalClose.call(this));
        });
        const connectSpy = vi.spyOn(Client.prototype, 'connect').mockImplementation(function (this: Client, ...args) {
            connects += 1;
            return originalConnect.apply(this, args);
        });

        try {
            const pending = Promise.all([
                transport.call('board', 'list', { limit: 1 }, undefined, { headers: { 'x-api-key': 'second' } }),
                transport.call('board', 'list', { limit: 2 }, undefined, { headers: { 'x-api-key': 'second' } })
            ]);
            await closeStarted;
            releaseClose();
            const [first, second] = await pending;
            expect(first).toEqual({ items: ['alpha'], era: 'modern' });
            expect(second).toEqual({ items: ['alpha', 'beta'], era: 'modern' });
            expect(connects).toBe(1);
        } finally {
            releaseClose();
            closeSpy.mockRestore();
            connectSpy.mockRestore();
        }
    });

    it('lists tools with annotations for the provider', async () => {
        const fixture = await track(modernServer());
        const tools = await client({ url: fixture.url, serverId: 'board' }).listTools();
        const list = tools.find(tool => tool.name === 'list')!;
        expect(list).toMatchObject({ serverId: 'board', annotations: { readOnlyHint: true } });
        expect(list.outputSchema).toBeDefined();
    });
});

describe('MCP capability end to end through the provider, admission, and executor', () => {
    it('carries the slot credential per call and fails deterministically after revocation', async () => {
        const fixture = await track(modernServer('k-live'));
        const { manifest } = await installFrom(fixture, 'k-live', 'list', true);
        expect(manifest).toMatchObject({ effect: 'read', approval: 'auto', auth: { kind: 'apiKey', in: 'header', name: 'x-api-key' } });
        const slot = transportCredentialSlot(manifest.transport, manifest.auth);
        expect(manifest.auth.secretRef).toBe(slot);
        expect(JSON.stringify(manifest)).not.toContain('k-live');

        capabilitySecrets.set(slot!, 'k-live');
        const ran = await executeCapability(manifest.id, { limit: 1 });
        expect(ran.ok).toBe(true);
        expect(ran.typed?.value).toEqual({ items: ['alpha'], era: 'modern' });
        expect(fixture.seen.filter(entry => entry.method === 'tools/call').every(entry => entry.apiKey === 'k-live')).toBe(true);

        const before = fixture.seen.length;
        expect(capabilitySecrets.revoke(slot!)).toBe(true);
        const revoked = await executeCapability(manifest.id, { limit: 1 });
        expect(revoked.error?.code).toBe('AUTH_UNBOUND');
        expect(fixture.seen.length).toBe(before);
    });

    it('does not let an untrusted readOnlyHint grant read/auto', async () => {
        const fixture = await track(modernServer('k-live'));
        const { manifest } = await installFrom(fixture, 'k-live', 'list', false);
        expect(manifest).toMatchObject({ effect: 'write', approval: 'pending' });
        capabilitySecrets.set(manifest.auth.secretRef!, 'k-live');
        const refused = await executeCapability(manifest.id, {});
        expect(refused.error?.code).toBe('EFFECT_NOT_APPROVED');
        expect(fixture.seen.map(entry => entry.method)).not.toContain('tools/call');
    });

    it('refuses a wrong credential without calling the tool', async () => {
        const fixture = await track(modernServer('k-live'));
        const { manifest } = await installFrom(fixture, 'k-live', 'list', true);
        capabilitySecrets.set(manifest.auth.secretRef!, 'k-wrong');
        const denied = await executeCapability(manifest.id, {});
        expect(denied.ok).toBe(false);
        expect(denied.error?.code).toBe('UPSTREAM_ERROR');
        expect(denied.error?.message).toMatch(/401|unauthori[sz]ed|authenticat/i);
        expect(fixture.seen.some(entry => entry.apiKey === 'k-wrong')).toBe(true);
        expect(fixture.seen.filter(entry => entry.apiKey === 'k-wrong').map(entry => entry.method)).not.toContain('tools/call');
    });

    it('forwards cancellation into the SDK call', async () => {
        const fixture = await track(modernServer('k-live'));
        const { manifest } = await installFrom(fixture, 'k-live', 'slow', true);
        capabilitySecrets.set(manifest.auth.secretRef!, 'k-live');
        approveCapability(manifest.id);
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 100);
        const result = await executeCapability(manifest.id, {}, { signal: controller.signal });
        expect(Date.now() - started).toBeLessThan(2_500);
        expect(manifest.effect).toBe('write');
        expect(result.error?.code).toBe('EFFECT_UNCERTAIN');
        expect(fixture.seen.map(entry => entry.method)).toContain('tools/call');
    });
});

describe('production MCP path', () => {
    it('does not hardcode a protocol version or frame JSON-RPC itself', () => {
        const source = readFileSync(path.join(process.cwd(), 'src/core/capabilities/mcpClient.ts'), 'utf8');
        expect(source).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
        expect(source).not.toMatch(/jsonrpc|text\/event-stream|mcp-session-id/i);
        expect(source).toContain("from '@modelcontextprotocol/client'");
    });
});
