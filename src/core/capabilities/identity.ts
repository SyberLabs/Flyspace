// Capability identity and credential slots.
// An id is a function of origin and operation, not of a friendly operationId.
// A secret slot is a function of origin, scheme, and placement. Two APIs that
// both say "ApiKey" do not share a credential.

import { sha256 } from './hash';
import type { AuthBinding, CapabilityTransport } from './manifest';

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
    return `http|${canonicalBase(transport.baseUrl)}|${transport.method}|${transport.path}`;
}

export function canonicalCapabilityId(transport: CapabilityTransport): string {
    const key = capabilityIdentityKey(transport);
    return PINNED_LOCAL[key] ?? `cap_${sha256(key).slice(0, 24)}`;
}

/** Slot name for one origin + scheme + placement. Never reused across origins. */
export function credentialSlot(baseUrl: string, auth: Pick<AuthBinding, 'kind' | 'in' | 'name'>): string {
    const origin = new URL(baseUrl).origin;
    const placement = auth.kind === 'apiKey' ? `${auth.in ?? ''}:${auth.name ?? ''}` : auth.kind;
    return `cred_${sha256(`${origin}|${auth.kind}|${placement}`).slice(0, 20)}`;
}
