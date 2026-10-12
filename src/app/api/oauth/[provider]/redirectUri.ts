import type { NextRequest } from 'next/server';

/**
 * The callback URL registered with the provider. It must be on the origin the
 * browser started from, or the flow cookie set at start is not sent back.
 * OMNI_OAUTH_ORIGIN pins it (behind a proxy that rewrites Host); otherwise it
 * is the Host the browser sent, which can differ from the server's own idea
 * of its URL (`next start` reports localhost for 127.0.0.1). The provider
 * refuses any URL the owner did not register, so a forged Host header cannot
 * send a code elsewhere.
 */
export function redirectUriFor(request: NextRequest, provider: string): string {
    const pinned = process.env.OMNI_OAUTH_ORIGIN?.trim();
    const url = new URL(request.url);
    const host = request.headers.get('host');
    const origin = pinned || (host ? `${url.protocol}//${host}` : url.origin);
    return `${origin.replace(/\/+$/, '')}/api/oauth/${encodeURIComponent(provider)}/callback`;
}
