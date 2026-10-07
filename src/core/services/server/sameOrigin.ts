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

/** The names a loopback listener answers to. `URL.hostname` keeps IPv6 brackets. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Whether `origin` is this server's own.
 *
 * Exact match against the request URL's origin, with one widening: when this
 * server is itself on loopback, the loopback names are one server on the same
 * scheme and port. `next dev -H 127.0.0.1` prints `http://127.0.0.1:3000` as
 * the address to open, yet reports its own origin as `http://localhost:3000`
 * (verified on Next 16.3.8), so an exact match refused every POST from the
 * address the dev server tells people to use.
 *
 * Deliberately not "Origin matches the Host header": under DNS rebinding an
 * attacker's name resolves to 127.0.0.1, and the browser then sends a
 * matching Origin and Host. Here the attacker's page still carries its own
 * non-loopback name, and it is refused. A different local server on another
 * port is refused by the port check.
 */
export function isOwnOrigin(origin: string | null, requestUrl: string): boolean {
    if (!origin) return false;
    const own = new URL(requestUrl);
    if (origin === own.origin) return true;
    let claimed: URL;
    try {
        claimed = new URL(origin);
    } catch {
        return false;
    }
    // A serialized Origin is scheme://host[:port] and nothing else.
    if (claimed.origin !== origin) return false;
    return LOOPBACK_HOSTS.has(own.hostname)
        && LOOPBACK_HOSTS.has(claimed.hostname)
        && claimed.protocol === own.protocol
        && claimed.port === own.port;
}

/**
 * Returns the refusal to send, or null when the request may proceed. Call it
 * before any body byte is read so a refused request costs no read and no parse.
 */
export function requireSameOrigin(request: Request): NextResponse | null {
    if (!isOwnOrigin(request.headers.get('origin'), request.url)) {
        return refuse(403, { error: 'Request must come from this site.' });
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return refuse(415, { error: 'Content-Type must be application/json.' });
    }
    return null;
}
