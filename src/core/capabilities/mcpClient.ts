// Live MCP client over Streamable HTTP.
// The compiler still only reads schemas. This speaks JSON-RPC: initialize,
// then tools/call. A bound client is what executeCapability dispatches to.

import type { McpTransport } from './execute';

const PROTOCOL = '2025-03-26';

export interface McpClientOptions {
    url: string;
    fetchImpl?: typeof fetch;
    clientName?: string;
}

interface JsonRpcResponse {
    jsonrpc?: string;
    id?: number | string;
    result?: unknown;
    error?: { code?: number; message?: string };
}

export function createMcpHttpTransport(options: McpClientOptions): McpTransport {
    const fetchImpl = options.fetchImpl ?? fetch;
    let sessionId: string | undefined;
    let initialized = false;
    let nextId = 1;

    return {
        async call(_serverId, toolName, args, signal) {
            if (!initialized) {
                await initialize(options.url, fetchImpl, (id) => { sessionId = id; }, signal, options.clientName);
                initialized = true;
            }
            const response = await rpc(options.url, fetchImpl, sessionId, {
                jsonrpc: '2.0',
                id: nextId++,
                method: 'tools/call',
                params: { name: toolName, arguments: args }
            }, signal);
            const result = asRecord(response.result);
            if (result?.isError === true) {
                throw new Error(textContent(result) || 'MCP tool returned an error');
            }
            if (result && 'structuredContent' in result && result.structuredContent !== undefined) {
                return result.structuredContent;
            }
            const text = result ? textContent(result) : '';
            if (text) {
                try {
                    return JSON.parse(text) as unknown;
                } catch {
                    return text;
                }
            }
            return response.result;
        }
    };
}

async function initialize(
    url: string,
    fetchImpl: typeof fetch,
    setSession: (id: string | undefined) => void,
    signal: AbortSignal | undefined,
    clientName: string | undefined
): Promise<void> {
    const opened = await rpcRaw(url, fetchImpl, undefined, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: PROTOCOL,
            capabilities: {},
            clientInfo: { name: clientName ?? 'omni', version: '0.1.0' }
        }
    }, signal);
    setSession(opened.sessionId);
    await rpcRaw(url, fetchImpl, opened.sessionId, {
        jsonrpc: '2.0',
        method: 'notifications/initialized'
    }, signal);
}

async function rpc(
    url: string,
    fetchImpl: typeof fetch,
    sessionId: string | undefined,
    body: unknown,
    signal: AbortSignal | undefined
): Promise<JsonRpcResponse> {
    const opened = await rpcRaw(url, fetchImpl, sessionId, body, signal);
    if (!opened.message) throw new Error('MCP server returned an empty response');
    if (opened.message.error) {
        throw new Error(opened.message.error.message || 'MCP request failed');
    }
    return opened.message;
}

async function rpcRaw(
    url: string,
    fetchImpl: typeof fetch,
    sessionId: string | undefined,
    body: unknown,
    signal: AbortSignal | undefined
): Promise<{ sessionId?: string; message?: JsonRpcResponse }> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL
    };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal
    });
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    const nextSession = response.headers.get('mcp-session-id') ?? sessionId;
    const text = await response.text();
    if (!text.trim()) return { sessionId: nextSession ?? undefined };
    return { sessionId: nextSession ?? undefined, message: parseRpc(text, response.headers.get('content-type') ?? '') };
}

function parseRpc(text: string, contentType: string): JsonRpcResponse {
    if (contentType.includes('text/event-stream') || text.includes('\ndata:') || text.startsWith('data:')) {
        const data = text
            .split('\n')
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim())
            .filter(line => line && line !== '[DONE]');
        const last = data[data.length - 1];
        if (!last) throw new Error('MCP event stream had no payload');
        return JSON.parse(last) as JsonRpcResponse;
    }
    return JSON.parse(text) as JsonRpcResponse;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function textContent(result: Record<string, unknown>): string {
    if (!Array.isArray(result.content)) return '';
    return result.content
        .map(entry => asRecord(entry)?.text)
        .filter((text): text is string => typeof text === 'string')
        .join('\n');
}
