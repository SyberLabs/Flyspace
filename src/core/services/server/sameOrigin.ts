// Same-origin admission for server routes that spend a key or reach an
// upstream on the caller's behalf. Only this app's own pages may drive them:
// a cross-site form or a `mode: 'no-cors'` fetch cannot set an
// application/json content type without a CORS preflight, and a browser
// always sends Origin on a POST. A request with no Origin at all is refused
// too (non-browser clients included); there is no such client today, and
// admitting one is a decision for the owner, not a default.

import { NextResponse } from 'next/server';

function refuse(status: number, body: unknown): NextResponse {
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/**
 * Returns the refusal to send, or null when the request may proceed. Call it
 * before any body byte is read so a refused request costs no read and no parse.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) {
        return refuse(403, { error: 'Request must come from this site.' });
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return refuse(415, { error: 'Content-Type must be application/json.' });
    }
    return null;
}
