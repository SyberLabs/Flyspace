// MCP client over the official TypeScript SDK v2 (Streamable HTTP).
// The SDK owns version negotiation, framing, SSE, and cancellation. This
// adapter owns only what Omni needs from it: a bound McpTransport for
// executeCapability and a tool lister for the MCP provider. Tool import
// policy, effect classification, and credential slots stay in Omni.

import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client';
import type { McpCallContext, McpTransport } from './execute';
import { canonicalize, sha256 } from './hash';
import type { McpToolSchema } from './mcp';

export interface McpServerConfig {
    url: string;
    /** Labels tools returned by listTools. The provider re-labels them with its own server id. */
    serverId?: string;
    /**
     * Headers sent on every request, visible to whoever builds this config.
     * A secret belongs in a credential slot instead: execution resolves the
     * slot and passes it per call, so revoking the slot stops the next call.
     */
    headers?: Record<string, string>;
    clientName?: string;
    clientVersion?: string;
    /** Defaults to `auto`: probe the modern era, fall back to the 2025 handshake. */
    versionNegotiation?: VersionNegotiationMode;
}

export type McpProtocolEra = 'legacy' | 'modern';

export interface McpSdkTransport extends McpTransport {
    listTools(signal?: AbortSignal, context?: McpCallContext): Promise<McpToolSchema[]>;
    protocolEra(): McpProtocolEra | undefined;
    close(): Promise<void>;
}

interface Session {
    key: string;
    client: Client;
    ready: Promise<Client>;
}

export function createMcpHttpTransport(config: McpServerConfig): McpSdkTransport {
    let session: Session | undefined;

    async function connected(context: McpCallContext | undefined, signal: AbortSignal | undefined): Promise<Client> {
        const headers = { ...(config.headers ?? {}), ...(context?.headers ?? {}) };
        const key = sha256(canonicalize(headers));
        if (session?.key === key) return session.ready;
        const previous = session;
        session = undefined;
        if (previous) await previous.client.close().catch(() => undefined);

        const client = new Client(
            { name: config.clientName ?? 'omni', version: config.clientVersion ?? '0.1.0' },
            { versionNegotiation: { mode: config.versionNegotiation ?? 'auto' } }
        );
        const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } });
        const ready = client.connect(transport, signal ? { signal } : undefined).then(() => client);
        const current: Session = { key, client, ready };
        session = current;
        ready.catch(() => {
            if (session === current) session = undefined;
        });
        return ready;
    }

    return {
        async call(_serverId, toolName, args, signal, context) {
            const client = await connected(context, signal);
            const result = await client.callTool({ name: toolName, arguments: args }, signal ? { signal } : undefined);
            return toolValue(result as Record<string, unknown>);
        },

        async listTools(signal, context) {
            const client = await connected(context, signal);
            const tools: McpToolSchema[] = [];
            let cursor: string | undefined;
            do {
                const page = await client.listTools(cursor ? { cursor } : undefined, signal ? { signal } : undefined);
                for (const tool of page.tools) {
                    tools.push({
                        serverId: config.serverId ?? '',
                        name: tool.name,
                        ...(tool.description ? { description: tool.description } : {}),
                        inputSchema: tool.inputSchema,
                        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
                        ...(tool.annotations ? {
                            annotations: {
                                ...(tool.annotations.readOnlyHint !== undefined ? { readOnlyHint: tool.annotations.readOnlyHint } : {}),
                                ...(tool.annotations.destructiveHint !== undefined ? { destructiveHint: tool.annotations.destructiveHint } : {}),
                                ...(tool.annotations.idempotentHint !== undefined ? { idempotentHint: tool.annotations.idempotentHint } : {})
                            }
                        } : {})
                    });
                }
                cursor = page.nextCursor;
            } while (cursor);
            return tools;
        },

        protocolEra() {
            return session?.client.getProtocolEra();
        },

        async close() {
            const current = session;
            session = undefined;
            if (current) await current.client.close().catch(() => undefined);
        }
    };
}

function toolValue(result: Record<string, unknown>): unknown {
    if (result.isError === true) {
        throw new Error(textContent(result) || 'MCP tool returned an error');
    }
    if ('structuredContent' in result && result.structuredContent !== undefined) {
        return result.structuredContent;
    }
    const text = textContent(result);
    if (text) {
        try {
            return JSON.parse(text) as unknown;
        } catch {
            return text;
        }
    }
    return result;
}

function textContent(result: Record<string, unknown>): string {
    if (!Array.isArray(result.content)) return '';
    return result.content
        .map(entry => (typeof entry === 'object' && entry !== null ? (entry as { text?: unknown }).text : undefined))
        .filter((text): text is string => typeof text === 'string')
        .join('\n');
}
