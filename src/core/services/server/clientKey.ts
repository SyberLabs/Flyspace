// One rule for "who is calling", for every route that budgets per caller.
// The key prefers an address a platform asserted and never trusts a header
// the client could have written on its own. Without a trusted proxy every
// caller shares one bucket, so a forged header buys nothing and the global
// cap is the backstop, as before.

const KEY_MAX = 64;
/** Where the trusted-proxy flag is read from; `process.env` by default. */
export type ClientKeyEnv = Readonly<Record<string, string | undefined>>;
/** Every unproxied caller shares this bucket. */
export const DIRECT_CLIENT = 'direct';

/**
 * `OMNI_TRUSTED_PROXY=1` declares that a proxy you control sits in front of
 * this server and sets `x-real-ip` or appends to `x-forwarded-for`. Default
 * off: a bare `next dev` or `next start` has no such proxy, and there a client
 * can write both headers.
 */
export function trustedProxyDeclared(env: ClientKeyEnv = process.env): boolean {
    return env.OMNI_TRUSTED_PROXY?.trim() === '1';
}

function lastHop(forwarded: string | null): string | undefined {
    return forwarded?.split(',').map(part => part.trim()).filter(Boolean).pop();
}

/**
 * The per-caller limiter key for a request, in this order:
 * 1. `cf-connecting-ip`: Cloudflare sets it on the Workers path and
 *    overwrites any value a client sent, so it cannot be forged from outside.
 * 2. `x-real-ip`, only when a trusted proxy is declared.
 * 3. The last `x-forwarded-for` hop (the address the nearest proxy saw),
 *    only when a trusted proxy is declared.
 * 4. `DIRECT_CLIENT`: one shared bucket under the global cap.
 */
export function clientKey(request: Request, env: ClientKeyEnv = process.env): string {
    const headers = request.headers;
    const cloudflare = headers.get('cf-connecting-ip')?.trim();
    if (cloudflare) return cloudflare.slice(0, KEY_MAX);
    if (trustedProxyDeclared(env)) {
        const real = headers.get('x-real-ip')?.trim();
        if (real) return real.slice(0, KEY_MAX);
        const hop = lastHop(headers.get('x-forwarded-for'));
        if (hop) return hop.slice(0, KEY_MAX);
    }
    return DIRECT_CLIENT;
}
