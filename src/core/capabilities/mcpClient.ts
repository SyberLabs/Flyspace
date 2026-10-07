// MCP client over the official TypeScript SDK v2 (Streamable HTTP).
// The SDK owns version negotiation, framing, SSE, and cancellation. This
// adapter owns only what Omni needs from it: a bound McpTransport for
// executeCapability and a tool lister for the MCP provider. Tool import
// policy, effect classification, and credential slots stay in Omni.

import { Client, StreamableHTTPClientTransport, type VersionNegotiationMode } from '@modelcontextprotocol/client';
import { destinationUrlErrors } from './egress';
import type { McpCallContext, McpTransport } from './execute';
import { canonicalize, sha256 } from './hash';
import type { McpToolSchema } from './mcp';

export interface McpServerConfig {
    /**
     * Checked against the http base URL rule (`destinationUrlErrors`) when
     * the transport is created, before any session opens: https, no embedded
     * credentials, query or fragment, no private or metadata address.
     */
    url: string;
    /**
     * The host itself built this config (not a manifest, provider, model or
     * stored snapshot). Only then may `url` target loopback, http or https:
     * the same gate as `validateManifest(..., { hostCreated: true })`.
     */
    hostCreated?: boolean;
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
    /** Requests holding this session that have not settled. */
    active: number;
    /** Replaced by a session for another key; it closes when `active` reaches zero. */
    retired: boolean;
    closed: boolean;
}

export function createMcpHttpTransport(config: McpServerConfig): McpSdkTransport {
    // The same rule an http transport.baseUrl passes, applied once, before
    // a credential can be attached to anything.
    const refused = destinationUrlErrors(config.url, { hostCreated: config.hostCreated === true, subject: 'config' });
    if (refused.length > 0) throw new Error(`MCP server URL ${refused.join('; ')}`);
    const url = new URL(config.url);
    const origin = url.origin;

    let session: Session | undefined;
    /** Replaced sessions that still have requests in flight. */
    const draining = new Set<Session>();
    // One header key has one in-flight session. Connect used to drop the
    // current session and await close() before storing the next one, so two
    // overlapping calls could each construct a client. The chain is the slot:
    // a second call with the same key waits and reuses the session the first
    // call publishes, instead of opening another.
    let connectChain: Promise<void> = Promise.resolve();

    /**
     * Take a lease on the session for these headers. The lease is counted
     * inside the chain, before the next caller can switch keys, so a switch
     * never closes a session whose request is still pending: SDK close()
     * rejects every pending response, even when the remote side effect
     * completes. The caller releases the lease when its request settles.
     */
    function lease(context: McpCallContext | undefined, signal: AbortSignal | undefined): Promise<Session> {
        const headers = { ...(config.headers ?? {}), ...(context?.headers ?? {}) };
        const key = sha256(canonicalize(headers));
        const opening = connectChain.then(() => openSession(key, headers, signal));
        connectChain = opening.then(() => undefined, () => undefined);
        return opening;
    }

    function release(held: Session): void {
        held.active -= 1;
        if (held.retired && held.active === 0) void closeSession(held);
    }

    function closeSession(held: Session): Promise<void> {
        draining.delete(held);
        if (held.closed) return Promise.resolve();
        held.closed = true;
        return held.client.close().catch(() => undefined);
    }

    async function openSession(key: string, headers: Record<string, string>, signal: AbortSignal | undefined): Promise<Session> {
        if (session && session.key === key) {
            const current = session;
            current.active += 1;
            try {
                await current.ready;
            } catch (error) {
                release(current);
                throw error;
            }
            return current;
        }
        const previous = session;
        session = undefined;
        if (previous) {
            previous.retired = true;
            // An idle session closes now, as before. A busy one drains first.
            if (previous.active === 0) await closeSession(previous);
            else draining.add(previous);
        }

        const client = new Client(
            { name: config.clientName ?? 'omni', version: config.clientVersion ?? '0.1.0' },
            { versionNegotiation: { mode: config.versionNegotiation ?? 'auto' } }
        );
        // The SDK (v2.2.0, src/client/streamableHttp.ts) spreads requestInit
        // into every fetch init (GET stream, POST, DELETE) and overrides only
        // method, headers, body and signal, so `redirect` reaches fetch. A 3xx
        // then comes back as a non-ok response and fails the request; the
        // credentialed request is never replayed to the host Location names.
        const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers, redirect: 'manual' } });
        const ready = client.connect(transport, signal ? { signal } : undefined).then(() => client);
        const current: Session = { key, client, ready, active: 1, retired: false, closed: false };
        session = current;
        ready.catch(() => {
            if (session === current) session = undefined;
        });
        try {
            await ready;
        } catch (error) {
            release(current);
            throw error;
        }
        return current;
    }

    return {
        origin,

        async call(_serverId, toolName, args, signal, context) {
            const held = await lease(context, signal);
            try {
                const result = await held.client.callTool({ name: toolName, arguments: args }, signal ? { signal } : undefined);
                return toolValue(result as Record<string, unknown>);
            } finally {
                release(held);
            }
        },

        async listTools(signal, context) {
            const held = await lease(context, signal);
            try {
                return await listAllTools(held.client, signal);
            } finally {
                release(held);
            }
        },

        protocolEra() {
            return session?.client.getProtocolEra();
        },

        close() {
            const closing = connectChain.then(async () => {
                const current = session;
                session = undefined;
                const open = [...draining, ...(current ? [current] : [])];
                await Promise.all(open.map(closeSession));
            });
            connectChain = closing.then(() => undefined, () => undefined);
            return closing;
        }
    };

    async function listAllTools(client: Client, signal: AbortSignal | undefined): Promise<McpToolSchema[]> {
        const tools: McpToolSchema[] = [];
        let cursor: string | undefined;
        do {
            const page = await client.listTools(cursor ? { cursor } : undefined, signal ? { signal } : undefined);
            for (const tool of page.tools) {
                tools.push({
                    serverId: config.serverId ?? '',
                    origin,
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
    }
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
