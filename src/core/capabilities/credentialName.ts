/**
 * Names that usually carry a credential. Some specs pass their key as an
 * ordinary parameter (Interzoid's `license`) instead of declaring a security
 * scheme, so it arrives as a plain input. A name alone cannot prove it, so
 * callers use this to be careful (mask a field, drop a sample value), never
 * to decide where a secret goes.
 */
const KEY_LIKE = /(^|[_\-.])(api[_-]?key|apikey|key|token|access[_-]?token|secret|license|licence|password|passwd|auth)($|[_\-.])/i;

export function looksLikeKey(name: string, description?: string): boolean {
    return KEY_LIKE.test(name) && !SAYS_CURSOR.test(description ?? '');
}

/** Names that only ever mean "your key for this API". */
const KEY_NAME = /^(x-)?(api[_-]?key|app[_-]?key|access[_-]?key|subscription[_-]?key|ocp-apim-subscription-key|licen[cs]e[_-]?key)$/i;
/** Names that mean a key only when the spec's own words say so. */
const MAYBE_KEY_NAME = /^(x-)?(key|licen[cs]e|token|access[_-]?token|auth[_-]?token|api[_-]?token|auth)$/i;
/** How a spec says a parameter is the caller's credential. */
const SAYS_KEY = /\b(api[ -]?key|licen[cs]e key|access key|access token|subscription key|auth(entication|orization)? (key|token)|your (own )?(api |licen[cs]e |access |subscription |developer )?(key|token)|credential|register (at|for|here))/i;
/** Words that make a "token" a cursor, not a credential. */
const SAYS_CURSOR = /\b(next page|page token|pagination|paging|cursor|continuation|offset)\b/i;

export interface KeyParameterCandidate {
    name: string;
    in: string;
    description?: string;
}

/**
 * Whether a parameter is the API's own key, passed as an ordinary parameter
 * instead of a declared security scheme (Interzoid's `license`, many
 * `api_key` query parameters). Strict on purpose: a false yes would take an
 * input away from the block and ask for it as a secret.
 */
export function isKeyParameter(parameter: KeyParameterCandidate): boolean {
    if (parameter.in !== 'query' && parameter.in !== 'header') return false;
    const description = parameter.description ?? '';
    if (KEY_NAME.test(parameter.name)) return !SAYS_CURSOR.test(description);
    if (!MAYBE_KEY_NAME.test(parameter.name)) return false;
    return SAYS_KEY.test(description) && !SAYS_CURSOR.test(description);
}
