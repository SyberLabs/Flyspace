// Connect, in the browser: sign in to a provider for one oauth manifest
// (src/core/services/server/oauthConnect.ts runs the flow). The token goes
// into the manifest's own slot, in session memory like a typed key, and is
// dropped when it expires. Only a manifest on the provider's own hosts gets
// a Connect button, and its slot is per origin and scope set, so a token
// never reaches another host.

import { CONNECT_CHANNEL, connectProvider, providerForBaseUrl, type ConnectProvider, type ConnectProviderId } from './connectProviders';
import type { CapabilityManifest } from './manifest';
import { capabilitySecrets } from './secrets';

const CONNECT_TIMEOUT_MS = 5 * 60_000;

export interface SignInSlot {
    provider: ConnectProvider;
    slot: string;
    scopes: string[];
}

/** The sign-in a manifest needs, when Flyspace can connect it. */
export function signInSlotOf(manifest: CapabilityManifest | undefined): SignInSlot | null {
    if (!manifest || manifest.auth.kind !== 'oauth' || !manifest.auth.secretRef || manifest.transport.kind !== 'http') return null;
    const provider = providerForBaseUrl(manifest.transport.baseUrl);
    const scopes = manifest.auth.scopes ?? [];
    if (!provider || scopes.length === 0 || !scopes.every(scope => provider.isReadOnlyScope(scope))) return null;
    return { provider, slot: manifest.auth.secretRef, scopes: [...scopes].sort() };
}

let configured: ReadonlySet<ConnectProviderId> = new Set();
const listeners = new Set<() => void>();

function publish(next: Iterable<ConnectProviderId>): void {
    configured = new Set(next);
    for (const listener of listeners) listener();
}

export function isConnectConfigured(id: ConnectProviderId): boolean {
    return configured.has(id);
}

export function subscribeConnect(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Ask the server which providers it has an OAuth client for. Any failure: none. */
export async function loadConnectProviders(fetchImpl: typeof fetch = fetch): Promise<void> {
    try {
        const response = await fetchImpl('/api/oauth', { headers: { accept: 'application/json' } });
        if (!response.ok) return;
        const body = await response.json() as { providers?: unknown };
        if (!Array.isArray(body.providers)) return;
        publish(body.providers.filter((id): id is ConnectProviderId => typeof id === 'string' && connectProvider(id) !== undefined));
    } catch {
        // No server: nobody can sign in.
    }
}

export function setConnectProvidersForTests(next: Iterable<ConnectProviderId>): void {
    publish(next);
}

interface ConnectMessage {
    type?: unknown;
    ok?: unknown;
    nonce?: unknown;
    provider?: unknown;
    scopes?: unknown;
    accessToken?: unknown;
    expiresIn?: unknown;
    error?: unknown;
}

const expiries = new Map<string, ReturnType<typeof setTimeout>>();

function randomNonce(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface ConnectDeps {
    open?: (url: string) => { closed?: boolean } | null;
    channel?: (name: string) => Pick<BroadcastChannel, 'onmessage' | 'close'>;
    nonce?: () => string;
}

/**
 * Sign in for one manifest. Call it from the click itself: the window opens
 * synchronously, before any await, so a popup blocker lets it through.
 */
export function connectSignIn(manifest: CapabilityManifest, deps: ConnectDeps = {}): Promise<{ ok: true } | { ok: false; error: string }> {
    const signIn = signInSlotOf(manifest);
    if (!signIn) return Promise.resolve({ ok: false, error: 'This API has no sign-in Flyspace can connect' });
    const nonce = (deps.nonce ?? randomNonce)();
    const query = new URLSearchParams({ nonce });
    for (const scope of signIn.scopes) query.append('scope', scope);
    const url = `/api/oauth/${signIn.provider.id}/start?${query.toString()}`;
    const channel = (deps.channel ?? (name => new BroadcastChannel(name)))(CONNECT_CHANNEL);
    const popup = (deps.open ?? (target => window.open(target, 'flyspace-connect', 'popup,width=520,height=680')))(url);
    if (!popup) {
        channel.close();
        return Promise.resolve({ ok: false, error: 'The sign-in window was blocked. Allow pop-ups for this site and try again.' });
    }
    return new Promise(resolve => {
        const done = (outcome: { ok: true } | { ok: false; error: string }) => {
            clearTimeout(timer);
            channel.onmessage = null;
            channel.close();
            resolve(outcome);
        };
        const timer = setTimeout(() => done({ ok: false, error: 'Sign-in did not finish' }), CONNECT_TIMEOUT_MS);
        channel.onmessage = (event: MessageEvent) => {
            const message = event.data as ConnectMessage;
            if (!message || message.type !== 'flyspace-connect' || message.nonce !== nonce) return;
            if (message.ok !== true) {
                done({ ok: false, error: typeof message.error === 'string' ? message.error : 'Sign-in did not finish' });
                return;
            }
            const scopes = Array.isArray(message.scopes) ? [...message.scopes].sort() : [];
            if (message.provider !== signIn.provider.id || scopes.join(' ') !== signIn.scopes.join(' ')
                || typeof message.accessToken !== 'string' || message.accessToken.length === 0) {
                done({ ok: false, error: 'The sign-in answered for something else' });
                return;
            }
            // Session only: the device vault never keeps a sign-in.
            capabilitySecrets.set(signIn.slot, message.accessToken, { sessionOnly: true });
            const seconds = typeof message.expiresIn === 'number' && message.expiresIn > 0 ? message.expiresIn : 3600;
            clearTimeout(expiries.get(signIn.slot));
            // Drop it a minute early, so a block asks to sign in again instead of failing.
            expiries.set(signIn.slot, setTimeout(() => {
                expiries.delete(signIn.slot);
                if (capabilitySecrets.get(signIn.slot) === message.accessToken) capabilitySecrets.revoke(signIn.slot);
            }, Math.max(0, seconds - 60) * 1000));
            done({ ok: true });
        };
    });
}
