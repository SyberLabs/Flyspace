// ============================================
// PROJECT OMNI: THE ONE ID SOURCE
//
// Every id OmniOS mints (blocks, wires, shells, memory entries, chat messages,
// speech sessions, idempotency keys) comes from here, so uniqueness has one
// proof instead of a dozen hand-rolled `Date.now()` + `Math.random` strings.
// Two chat messages created in the same millisecond used to share an id, and
// the draft filter in the persona turn then deleted the earlier answer.
//
// Call sites keep their own prefix (`wire_`, `msg-`, ...) in front of the
// value. Ids are compared only by equality; nothing parses a timestamp or a
// prefix out of one, so new ids coexist with ids already persisted.
// ============================================

/**
 * A version-4 UUID from the platform CSPRNG.
 *
 * `crypto.randomUUID` exists on Node >= 20, Cloudflare Workers and every
 * browser in a secure context. One runtime this project documents lacks it: a
 * browser reaching a private-network container over plain http
 * (DEPLOYMENT.md, "A container deployment binds 0.0.0.0"), which is not a
 * secure context. `getRandomValues` is available there, so the fallback
 * builds the same v4 UUID from sixteen random bytes.
 */
export function newId(): string {
    const c = globalThis.crypto;
    if (typeof c.randomUUID === 'function') return c.randomUUID();
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
