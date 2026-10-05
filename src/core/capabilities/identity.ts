// Capability identity and credential slots.
// An id is a function of origin and operation, not of a friendly operationId.
// A secret slot is a function of origin, scheme, and placement (plus scopes
// for oauth). Two APIs that both say "ApiKey" do not share a credential.

import { sha256 } from './hash';
import type { AuthBinding, CapabilityTransport } from './manifest';

type SlotAuth = Pick<AuthBinding, 'kind' | 'in' | 'name' | 'scopes'>;

const PINNED_LOCAL: Record<string, string> = {
    'local|speech.speak': 'cap_speech_speak',
    'local|speech.listen': 'cap_speech_listen'
};

export function canonicalBase(baseUrl: string): string {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/$/, '');
    return `${url.origin}${path}`;
}

export function capabilityIdentityKey(transport: CapabilityTransport): string {
    if (transport.kind === 'local') return `local|${transport.handler}`;
    if (transport.kind === 'mcp') return `mcp|${transport.serverId}|${transport.toolName}`;
    if (transport.kind === 'async') return `async|${transport.runtimeId}|${transport.operation}`;
    return `http|${canonicalBase(transport.baseUrl)}|${transport.method}|${transport.path}`;
}

export function canonicalCapabilityId(transport: CapabilityTransport): string {
    const key = capabilityIdentityKey(transport);
    return PINNED_LOCAL[key] ?? `cap_${sha256(key).slice(0, 24)}`;
}

/** Slot name for one origin + scheme + placement. Never reused across origins. */
export function credentialSlot(baseUrl: string, auth: SlotAuth): string {
    return slotFor(new URL(baseUrl).origin, auth);
}

/**
 * Slot for any transport that can carry a credential. An MCP server is a URL
 * origin like an HTTP base and takes the same slot, so two servers that share
 * a label never share a secret. An async runtime is named by kind and
 * host-bound id, which cannot collide with a URL origin.
 */
export function transportCredentialSlot(
    transport: CapabilityTransport,
    auth: SlotAuth
): string | undefined {
    if (transport.kind === 'http') return credentialSlot(transport.baseUrl, auth);
    if (transport.kind === 'mcp') return credentialSlot(transport.origin, auth);
    if (transport.kind === 'async') return slotFor(`async:${transport.runtimeId}`, auth);
    return undefined;
}

function slotFor(destination: string, auth: SlotAuth): string {
    // An oauth token is only as broad as its scopes, so each scope set is its own slot.
    const placement = auth.kind === 'apiKey'
        ? `${auth.in ?? ''}:${auth.name ?? ''}`
        : auth.kind === 'oauth'
            ? `oauth:${[...new Set(auth.scopes ?? [])].sort().join(' ')}`
            : auth.kind;
    return `cred_${sha256(`${destination}|${auth.kind}|${placement}`).slice(0, 20)}`;
}
