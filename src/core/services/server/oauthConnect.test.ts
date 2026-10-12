import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { callbackPage, configuredProviders, finishConnect, startConnect } from './oauthConnect';

const ENV = { OMNI_GOOGLE_CLIENT_ID: 'client-123.apps.googleusercontent.com', OMNI_GOOGLE_CLIENT_SECRET: 'shh-client-secret' };
const READ = 'https://www.googleapis.com/auth/calendar.readonly';
const REDIRECT = 'http://127.0.0.1:3000/api/oauth/google/callback';
const NONCE = 'a'.repeat(32);

function started(now = 1_000) {
    const result = startConnect({ providerId: 'google', scopes: [READ], nonce: NONCE, redirectUri: REDIRECT, env: ENV, now });
    if (!result.ok) throw new Error(result.error);
    const url = new URL(result.redirect);
    return { cookie: result.cookie, url, state: url.searchParams.get('state')! };
}

function tokenFetch(body: unknown, status = 200) {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const finish = (overrides: Partial<Parameters<typeof finishConnect>[0]> & { state: string; cookie: string | undefined }) => finishConnect({
    providerId: 'google',
    query: new URLSearchParams({ state: overrides.state, code: 'auth-code' }),
    redirectUri: REDIRECT,
    env: ENV,
    now: 2_000,
    fetch: tokenFetch({ access_token: 'ya29.token', expires_in: 3599, scope: READ, token_type: 'Bearer' }) as unknown as typeof fetch,
    ...overrides
});

describe('Connect: starting a sign-in', () => {
    it('is not offered until the owner configures a client, and never in the public preview', () => {
        expect(configuredProviders({})).toEqual([]);
        expect(configuredProviders(ENV)).toEqual(['google']);
        expect(configuredProviders({ ...ENV, OMNI_PUBLIC_DEMO: '1' })).toEqual([]);
        const refused = startConnect({ providerId: 'google', scopes: [READ], nonce: NONCE, redirectUri: REDIRECT, env: {} });
        expect(refused).toMatchObject({ ok: false, status: 503 });
    });

    it('refuses a scope that can change data, and an unknown provider', () => {
        expect(startConnect({ providerId: 'google', scopes: ['https://www.googleapis.com/auth/calendar'], nonce: NONCE, redirectUri: REDIRECT, env: ENV }))
            .toMatchObject({ ok: false, status: 400 });
        expect(startConnect({ providerId: 'github', scopes: [READ], nonce: NONCE, redirectUri: REDIRECT, env: ENV }))
            .toMatchObject({ ok: false, status: 404 });
    });

    it('sends the browser to Google with PKCE, the read-only scope, and no refresh token', () => {
        const { url, cookie } = started();
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('client_id')).toBe(ENV.OMNI_GOOGLE_CLIENT_ID);
        expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
        expect(url.searchParams.get('scope')).toBe(READ);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('access_type')).toBe('online');
        expect(url.toString()).not.toContain(ENV.OMNI_GOOGLE_CLIENT_SECRET);
        expect(cookie).not.toContain(ENV.OMNI_GOOGLE_CLIENT_SECRET);
    });
});

describe('Connect: finishing a sign-in', () => {
    it('exchanges the code with the verifier and client secret, and returns the token for the nonce', async () => {
        const { cookie, state, url } = started();
        const fetchMock = tokenFetch({ access_token: 'ya29.token', expires_in: 3599, scope: READ, token_type: 'Bearer' });
        const result = await finish({ state, cookie, fetch: fetchMock as unknown as typeof fetch });
        expect(result).toEqual({ ok: true, providerId: 'google', nonce: NONCE, scopes: [READ], accessToken: 'ya29.token', expiresIn: 3599 });
        const [target, init] = fetchMock.mock.calls[0];
        expect(String(target)).toBe('https://oauth2.googleapis.com/token');
        const form = new URLSearchParams(String(init?.body));
        expect(form.get('client_secret')).toBe(ENV.OMNI_GOOGLE_CLIENT_SECRET);
        expect(form.get('redirect_uri')).toBe(REDIRECT);
        // The verifier answers the challenge that went to Google.
        const challenge = createHash('sha256').update(form.get('code_verifier')!).digest('base64url');
        expect(challenge).toBe(url.searchParams.get('code_challenge'));
    });

    it('refuses a callback this browser did not start', async () => {
        const { state } = started();
        expect(await finish({ state, cookie: undefined })).toMatchObject({ ok: false, error: 'This sign-in was not started in this browser' });
    });

    it('refuses a tampered cookie and a mismatched state', async () => {
        const { cookie, state } = started();
        const [body, mac] = cookie.split('.');
        const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), scopes: ['https://www.googleapis.com/auth/calendar'] })).toString('base64url');
        expect(await finish({ state, cookie: `${forged}.${mac}` })).toMatchObject({ ok: false });
        expect(await finish({ state: `${state.slice(0, -1)}x`, cookie })).toMatchObject({ ok: false, error: 'This sign-in was not started in this browser' });
    });

    it('refuses a non-ASCII state of the same length without throwing', async () => {
        const { cookie, state } = started();
        const result = await finish({ state: 'é'.repeat(state.length), cookie });
        expect(result).toMatchObject({ ok: false, error: 'This sign-in was not started in this browser' });
    });

    it('refuses a flow older than ten minutes', async () => {
        const { cookie, state } = started(0);
        expect(await finish({ state, cookie, now: 10 * 60_000 + 1 })).toMatchObject({ ok: false, nonce: NONCE, error: 'This sign-in took too long; try again' });
    });

    it('refuses when the person unticked a scope on the consent screen', async () => {
        const { cookie, state } = started();
        const result = await finish({ state, cookie, fetch: tokenFetch({ access_token: 'ya29.token', scope: 'openid', token_type: 'Bearer' }) as unknown as typeof fetch });
        expect(result).toMatchObject({ ok: false, error: `Access was not granted for: ${READ}` });
    });

    it('passes no provider error text on, and reports a cancelled sign-in plainly', async () => {
        const { cookie, state } = started();
        const refused = await finish({ state, cookie, fetch: tokenFetch({ error: 'invalid_grant', error_description: ENV.OMNI_GOOGLE_CLIENT_ID }, 400) as unknown as typeof fetch });
        expect(refused).toMatchObject({ ok: false, error: 'The provider refused the code (HTTP 400)' });
        const cancelled = await finish({ state, cookie, query: new URLSearchParams({ state, error: 'access_denied' }) });
        expect(cancelled).toMatchObject({ ok: false, error: 'Sign-in was cancelled' });
    });
});

describe('Connect: the callback page', () => {
    it('allows only its own script, by hash', () => {
        const page = callbackPage({ ok: true, providerId: 'google', nonce: NONCE, scopes: [READ], accessToken: 'ya29.token', expiresIn: 3599 });
        const script = /<script>([\s\S]*)<\/script>/.exec(page.html)![1];
        const hash = createHash('sha256').update(script).digest('base64');
        expect(page.csp).toBe(`default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
        expect(script).toContain('BroadcastChannel("flyspace-connect")');
    });

    it('cannot be broken out of by text in an error', () => {
        const page = callbackPage({ ok: false, nonce: NONCE, error: '</script><img src=x onerror=alert(1)>' });
        expect(page.html.match(/<\/script>/g)).toHaveLength(1);
        expect(page.html).not.toContain('<img');
        expect(page.html).not.toContain('ya29');
    });
});
