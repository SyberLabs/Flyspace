// GET /api/oauth/:provider/start?scope=...&scope=...&nonce=...
// Starts a read-only sign-in (oauthConnect.ts): a redirect to the provider,
// and an httpOnly cookie that binds the flow to this browser.

import { NextRequest, NextResponse } from 'next/server';
import { CONNECT_COOKIE, CONNECT_COOKIE_PATH, startConnect } from '@/core/services/server/oauthConnect';
import { redirectUriFor } from '../redirectUri';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
    // A top-level navigation from this app is same-origin; another site has no reason to start one.
    if (request.headers.get('sec-fetch-site') === 'cross-site') {
        return NextResponse.json({ error: 'Sign-in must start from this site.' }, { status: 403 });
    }
    const { provider } = await context.params;
    const url = new URL(request.url);
    const started = startConnect({
        providerId: provider,
        scopes: url.searchParams.getAll('scope'),
        nonce: url.searchParams.get('nonce') ?? '',
        redirectUri: redirectUriFor(request, provider)
    });
    if (!started.ok) {
        return new NextResponse(started.error, { status: started.status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
    }
    const response = NextResponse.redirect(started.redirect, 302);
    response.headers.set('cache-control', 'no-store');
    response.headers.set('referrer-policy', 'no-referrer');
    response.cookies.set(CONNECT_COOKIE, started.cookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: url.protocol === 'https:',
        path: CONNECT_COOKIE_PATH,
        maxAge: 600
    });
    return response;
}
