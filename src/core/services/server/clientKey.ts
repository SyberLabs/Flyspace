// One rule for "who is calling", for every route that budgets per caller.
// Every address header a request carries could have been written by the
// client unless something you control sits in front and owns that header,
// so the key trusts a header only when the deployment declares that
// ingress. Undeclared, every caller shares one bucket and the global cap is
// the backstop, as before.

const KEY_MAX = 64;
/** Where the ingress declaration is read from; `process.env` by default. */
export type ClientKeyEnv = Readonly<Record<string, string | undefined>>;
/** Every caller shares this bucket when no ingress is declared. */
export const DIRECT_CLIENT = 'direct';

export type Ingress = 'cloudflare' | 'proxy' | 'direct';

/**
 * `OMNI_TRUSTED_PROXY` names what sits in front of this server:
 * - `cloudflare`: a Cloudflare Worker or proxied zone, which sets
 *   `cf-connecting-ip` and overwrites any value the client sent.
 * - `proxy` (or `1`, the older spelling): a reverse proxy you control that
 *   sets `x-real-ip` or appends to `x-forwarded-for`.
 * Unset, or any other value, means nothing is trusted: a bare `next dev`,
 * `next start` or `wrangler dev` has no ingress that owns these headers.
 */
export function declaredIngress(env: ClientKeyEnv = process.env): Ingress {
    const value = env.OMNI_TRUSTED_PROXY?.trim().toLowerCase();
    if (value === 'cloudflare') return 'cloudflare';
    if (value === 'proxy' || value === '1') return 'proxy';
    return 'direct';
}

function lastHop(forwarded: string | null): string | undefined {
    return forwarded?.split(',').map(part => part.trim()).filter(Boolean).pop();
}

/**
 * The per-caller limiter key for a request, by declared ingress:
 * - `cloudflare`: `cf-connecting-ip`.
 * - `proxy`: `x-real-ip`, else the last `x-forwarded-for` hop (the address
 *   the nearest proxy saw).
 * - `direct`, or a declared header that is absent: `DIRECT_CLIENT`, one
 *   shared bucket under the global cap.
 * No header is trusted outside its declared ingress.
 */
export function clientKey(request: Request, env: ClientKeyEnv = process.env): string {
    const headers = request.headers;
    let address: string | undefined;
    switch (declaredIngress(env)) {
        case 'cloudflare':
            address = headers.get('cf-connecting-ip')?.trim();
            break;
        case 'proxy':
            address = headers.get('x-real-ip')?.trim() || lastHop(headers.get('x-forwarded-for'));
            break;
        case 'direct':
            break;
    }
    return address ? address.slice(0, KEY_MAX) : DIRECT_CLIENT;
}
