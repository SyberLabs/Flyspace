/**
 * Names that usually carry a credential. Some specs pass their key as an
 * ordinary parameter (Interzoid's `license`) instead of declaring a security
 * scheme, so it arrives as a plain input. A name alone cannot prove it, so
 * callers use this to be careful (mask a field, drop a sample value), never
 * to decide where a secret goes.
 */
const KEY_LIKE = /(^|[_\-.])(api[_-]?key|apikey|key|token|access[_-]?token|secret|license|licence|password|passwd|auth)($|[_\-.])/i;

export function looksLikeKey(name: string): boolean {
    return KEY_LIKE.test(name);
}
