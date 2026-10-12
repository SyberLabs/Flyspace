// Providers Flyspace can sign in to with OAuth (APEX_PLAN 6.8, "Connect").
// The compiler binds an OpenAPI oauth2 scheme only when its authorization
// URL belongs to one of these, and only for a read operation with a
// read-only scope: a token Flyspace asks for can read, never change, the
// person's data. Write and destructive OAuth surface is not built (AGENTS.md
// stop condition 3).
//
// Whether the owner registered an OAuth client for a provider is a server
// fact (GET /api/oauth); this list is what the compiler may bind.

export interface ConnectProvider {
    id: 'google';
    title: string;
    /** Hosts an OpenAPI `authorizationUrl` may name for this provider. */
    authorizationHosts: readonly string[];
    /** Whether an API base URL belongs to this provider. */
    servesApi(host: string): boolean;
    /** Whether a scope only lets a token read. */
    isReadOnlyScope(scope: string): boolean;
}

export const CONNECT_PROVIDERS: readonly ConnectProvider[] = [
    {
        id: 'google',
        title: 'Google',
        authorizationHosts: ['accounts.google.com'],
        servesApi: host => host === 'googleapis.com' || host.endsWith('.googleapis.com'),
        // Google names its read-only scopes with a `.readonly` suffix
        // (calendar.readonly, drive.metadata.readonly, youtube.readonly).
        isReadOnlyScope: scope => /^https:\/\/www\.googleapis\.com\/auth\/[a-z0-9._-]+\.readonly$/i.test(scope)
    }
];

/** The same-origin BroadcastChannel a sign-in's callback page answers on. */
export const CONNECT_CHANNEL = 'flyspace-connect';

export type ConnectProviderId = ConnectProvider['id'];

export function connectProvider(id: string): ConnectProvider | undefined {
    return CONNECT_PROVIDERS.find(provider => provider.id === id);
}

/** The provider an OpenAPI authorization URL belongs to, if Flyspace can connect to it. */
export function providerForAuthorizationUrl(url: unknown): ConnectProvider | undefined {
    if (typeof url !== 'string') return undefined;
    let host: string;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return undefined;
        host = parsed.hostname;
    } catch {
        return undefined;
    }
    return CONNECT_PROVIDERS.find(provider => provider.authorizationHosts.includes(host));
}

/** The provider whose API a manifest's base URL is on, for its Connect button. */
export function providerForBaseUrl(baseUrl: string): ConnectProvider | undefined {
    let host: string;
    try {
        host = new URL(baseUrl).hostname;
    } catch {
        return undefined;
    }
    return CONNECT_PROVIDERS.find(provider => provider.servesApi(host));
}
