// ============================================
// SAME-ORIGIN ADMISSION — the gate on every POST route that spends a key.
//
// The route tests prove each route calls this before spending anything. These
// prove the gate itself: what it admits, what it refuses, and that the two
// refusals stay distinguishable to the caller.
// ============================================

import { describe, it, expect } from 'vitest';
import { isOwnOrigin, requireSameOrigin } from './sameOrigin';

const SITE = 'http://127.0.0.1:3000';

function post(headers: Record<string, string>, url = `${SITE}/api/llm`): Request {
    return new Request(url, { method: 'POST', headers, body: '{}' });
}

async function refusal(request: Request) {
    const response = requireSameOrigin(request);
    return response && { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
}

describe('admits', () => {
    it("this site's own JSON request", () => {
        expect(requireSameOrigin(post({ origin: SITE, 'content-type': 'application/json' }))).toBeNull();
    });

    it('a media type with parameters, in any case', () => {
        expect(requireSameOrigin(post({ origin: SITE, 'content-type': 'Application/JSON; charset=utf-8' }))).toBeNull();
    });

    it('judges the origin from the request URL, not a fixed host', () => {
        const url = 'https://omni.example.test/api/llm';
        expect(requireSameOrigin(post({ origin: 'https://omni.example.test', 'content-type': 'application/json' }, url)))
            .toBeNull();
    });
});

describe('refuses with 403', () => {
    it.each([
        ['another site', 'https://evil.example'],
        ['the same host on another port', 'http://127.0.0.1:3001'],
        ['the same host over another scheme', 'https://127.0.0.1:3000'],
        ['the opaque null origin', 'null'],
        ['an origin with a trailing slash', `${SITE}/`]
    ])('%s', async (_label, origin) => {
        expect(await refusal(post({ origin, 'content-type': 'application/json' })))
            .toEqual({ status: 403, body: { error: 'Request must come from this site.' }, cache: 'no-store' });
    });

    it('a request with no Origin at all', async () => {
        expect((await refusal(post({ 'content-type': 'application/json' })))?.status).toBe(403);
    });

    it('checks Origin before content type, so a cross-site caller learns nothing more', async () => {
        expect((await refusal(post({ origin: 'https://evil.example', 'content-type': 'text/plain' })))?.status)
            .toBe(403);
    });
});

describe('refuses with 415', () => {
    it.each([
        // The three media types a CORS simple request may carry without a preflight.
        'text/plain',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
        // Close but not JSON.
        'application/json-patch+json',
        'application/jsonp'
    ])('%s', async (contentType) => {
        expect(await refusal(post({ origin: SITE, 'content-type': contentType })))
            .toEqual({ status: 415, body: { error: 'Content-Type must be application/json.' }, cache: 'no-store' });
    });

    it('a same-origin request with no content type', async () => {
        const request = new Request(`${SITE}/api/llm`, { method: 'POST', headers: { origin: SITE } });
        expect((await refusal(request))?.status).toBe(415);
    });
});

describe('reads nothing', () => {
    it('leaves the body unread whether it admits or refuses', () => {
        const admitted = post({ origin: SITE, 'content-type': 'application/json' });
        const refused = post({ origin: 'https://evil.example', 'content-type': 'application/json' });
        requireSameOrigin(admitted);
        requireSameOrigin(refused);
        expect(admitted.bodyUsed).toBe(false);
        expect(refused.bodyUsed).toBe(false);
    });
});

describe('loopback aliases (next dev reports its origin as localhost)', () => {
    // What `next dev -H 127.0.0.1` hands a route handler as request.url.
    const DEV_URL = 'http://localhost:3000/api/llm';
    const json = { 'content-type': 'application/json' };

    it.each(['http://127.0.0.1:3000', 'http://localhost:3000', 'http://[::1]:3000'])(
        'admits the page at %s',
        origin => {
            expect(requireSameOrigin(post({ origin, ...json }, DEV_URL))).toBeNull();
        }
    );

    it.each([
        ['DNS rebinding: an attacker name resolving to 127.0.0.1', 'http://evil.example:3000'],
        ['another local server on another port', 'http://127.0.0.1:5173'],
        ['the same host over https', 'https://127.0.0.1:3000'],
        ['a loopback lookalike', 'http://127.0.0.1.evil.example:3000'],
        ['an origin carrying a path', 'http://127.0.0.1:3000/']
    ])('refuses %s', (_label, origin) => {
        expect(requireSameOrigin(post({ origin, ...json }, DEV_URL))?.status).toBe(403);
    });

    it('does not widen a server that is not on loopback', () => {
        const PUBLIC_URL = 'https://omni.example.test/api/llm';
        expect(requireSameOrigin(post({ origin: 'https://omni.example.test', ...json }, PUBLIC_URL))).toBeNull();
        expect(requireSameOrigin(post({ origin: 'http://localhost', ...json }, PUBLIC_URL))?.status).toBe(403);
    });
});

describe('isOwnOrigin', () => {
    it('refuses a missing or malformed origin', () => {
        expect(isOwnOrigin(null, 'http://localhost:3000/x')).toBe(false);
        expect(isOwnOrigin('not a url', 'http://localhost:3000/x')).toBe(false);
        expect(isOwnOrigin('null', 'http://localhost:3000/x')).toBe(false);
    });
});
