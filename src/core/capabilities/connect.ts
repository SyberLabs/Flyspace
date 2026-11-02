// The sign-in an oauth manifest would need. The public preview has no sign-in
// server, so a block can only say what it would ask for.

import { providerForBaseUrl, type ConnectProvider } from './connectProviders';
import type { CapabilityManifest } from './manifest';

export interface SignInSlot {
    provider: ConnectProvider;
    slot: string;
    scopes: string[];
}

/** The sign-in a manifest needs, when Flyspace knows its provider. */
export function signInSlotOf(manifest: CapabilityManifest | undefined): SignInSlot | null {
    if (!manifest || manifest.auth.kind !== 'oauth' || !manifest.auth.secretRef || manifest.transport.kind !== 'http') return null;
    const provider = providerForBaseUrl(manifest.transport.baseUrl);
    const scopes = manifest.auth.scopes ?? [];
    if (!provider || scopes.length === 0 || !scopes.every(scope => provider.isReadOnlyScope(scope))) return null;
    return { provider, slot: manifest.auth.secretRef, scopes: [...scopes].sort() };
}
