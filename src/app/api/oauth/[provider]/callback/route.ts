// GET /api/oauth/:provider/callback
// Where the provider returns the browser (oauthConnect.ts). Exchanges the
// code with the owner's client secret, checks the granted scopes, and hands
// the token to the page that started the sign-in. Nothing is stored or logged.

import { NextRequest, NextResponse } from 'next/server';
import { callbackPage, CONNECT_COOKIE, CONNECT_COOKIE_PATH, finishConnect } from '@/core/services/server/oauthConnect';
import { redirectUriFor } from '../redirectUri';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
    const { provider } = await context.params;
    const result = await finishConnect({
        providerId: provider,
        query: new URL(request.url).searchParams,
        cookie: request.cookies.get(CONNECT_COOKIE)?.value,
        redirectUri: redirectUriFor(request, provider)
    });
    const page = callbackPage(result);
    const response = new NextResponse(page.html, {
        status: result.ok ? 200 : 400,
        headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': page.csp,
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff'
        }
    });
    // One flow per cookie: spent whether it worked or not.
    response.cookies.set(CONNECT_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: CONNECT_COOKIE_PATH, maxAge: 0 });
    return response;
}
