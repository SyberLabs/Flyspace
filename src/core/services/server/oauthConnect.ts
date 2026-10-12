// Connect: OAuth sign-in for providers that require it (APEX_PLAN 6.8).
//
// Authorization code with PKCE, through an OAuth client the owner registers
// (OMNI_GOOGLE_CLIENT_ID / OMNI_GOOGLE_CLIENT_SECRET, server-side only). The
// flow keeps no server state: the PKCE verifier, the scopes asked for, and
// the opener's nonce ride in an httpOnly cookie signed with a key derived
// from the client secret, bound to the `state` parameter, valid 10 minutes,
// so start and callback may land on different instances.
//
// Only read-only scopes are asked for (connectProviders.ts), the granted
// scopes are checked against them, and the access token goes to the page
// that opened the sign-in, to live in its session memory like a typed key.
// No refresh token is requested and nothing is stored here.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CONNECT_CHANNEL, connectProvider, type ConnectProviderId } from '@/core/capabilities/connectProviders';

export const CONNECT_COOKIE = 'flyspace_connect';
export const CONNECT_COOKIE_PATH = '/api/oauth';
const FLOW_TTL_MS = 10 * 60_000;
const MAX_SCOPES = 20;

interface ProviderEndpoints {
    authorize: string;
    token: string;
    clientIdEnv: string;
    clientSecretEnv: string;
}

const ENDPOINTS: Record<ConnectProviderId, ProviderEndpoints> = {
    google: {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: 'https://oauth2.googleapis.com/token',
        clientIdEnv: 'OMNI_GOOGLE_CLIENT_ID',
        clientSecretEnv: 'OMNI_GOOGLE_CLIENT_SECRET'
    }
};

type Env = Record<string, string | undefined>;

interface Client {
    id: string;
    secret: string;
}

function clientFor(providerId: ConnectProviderId, env: Env): Client | null {
    // The public preview has no sign-in: its visitors are not the owner.
    if (env.OMNI_PUBLIC_DEMO === '1') return null;
    const endpoints = ENDPOINTS[providerId];
    const id = env[endpoints.clientIdEnv]?.trim();
    const secret = env[endpoints.clientSecretEnv]?.trim();
    return id && secret ? { id, secret } : null;
}

/** Providers whose OAuth client the owner configured. */
export function configuredProviders(env: Env = process.env): ConnectProviderId[] {
    return (Object.keys(ENDPOINTS) as ConnectProviderId[]).filter(id => clientFor(id, env) !== null);
}

interface FlowCookie {
    v: 1;
    provider: ConnectProviderId;
    state: string;
    verifier: string;
    scopes: string[];
    nonce: string;
    exp: number;
}

function base64url(buffer: Buffer): string {
    return buffer.toString('base64url');
}

function signingKey(client: Client): Buffer {
    return createHash('sha256').update('flyspace-connect-cookie\0').update(client.secret).digest();
}

function seal(flow: FlowCookie, client: Client): string {
    const body = base64url(Buffer.from(JSON.stringify(flow), 'utf8'));
    const mac = base64url(createHmac('sha256', signingKey(client)).update(body).digest());
    return `${body}.${mac}`;
}

function unseal(value: string | undefined, client: Client): FlowCookie | null {
    if (!value) return null;
    const [body, mac, extra] = value.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = createHmac('sha256', signingKey(client)).update(body).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    try {
        const flow = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as FlowCookie;
        return flow && flow.v === 1 ? flow : null;
    } catch {
        return null;
    }
}

export type StartResult =
    | { ok: true; redirect: string; cookie: string }
    | { ok: false; status: number; error: string };

/** Begin a sign-in: where to send the browser, and the cookie that binds the flow to it. */
export function startConnect(args: {
    providerId: string;
    scopes: string[];
    nonce: string;
    redirectUri: string;
    env?: Env;
    now?: number;
}): StartResult {
    const provider = connectProvider(args.providerId);
    if (!provider) return { ok: false, status: 404, error: 'Unknown sign-in provider' };
    const client = clientFor(provider.id, args.env ?? process.env);
    if (!client) return { ok: false, status: 503, error: `${provider.title} sign-in is not set up on this server` };
    const scopes = [...new Set(args.scopes)].sort();
    if (scopes.length === 0 || scopes.length > MAX_SCOPES) return { ok: false, status: 400, error: 'Ask for 1 to 20 scopes' };
    if (!scopes.every(scope => provider.isReadOnlyScope(scope))) {
        return { ok: false, status: 400, error: 'Flyspace only asks for read-only access' };
    }
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(args.nonce)) return { ok: false, status: 400, error: 'nonce is invalid' };

    const state = base64url(randomBytes(24));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const exp = (args.now ?? Date.now()) + FLOW_TTL_MS;
    const authorize = new URL(ENDPOINTS[provider.id].authorize);
    authorize.search = new URLSearchParams({
        client_id: client.id,
        redirect_uri: args.redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        access_type: 'online',
        include_granted_scopes: 'false',
        prompt: 'consent'
    }).toString();
    const cookie = seal({ v: 1, provider: provider.id, state, verifier, scopes, nonce: args.nonce, exp }, client);
    return { ok: true, redirect: authorize.toString(), cookie };
}

export type CallbackResult =
    | { ok: true; providerId: ConnectProviderId; nonce: string; scopes: string[]; accessToken: string; expiresIn: number }
    | { ok: false; nonce?: string; error: string };

/** Finish a sign-in: check the flow, exchange the code, and check what was granted. */
export async function finishConnect(args: {
    providerId: string;
    query: URLSearchParams;
    cookie: string | undefined;
    redirectUri: string;
    fetch?: typeof fetch;
    env?: Env;
    now?: number;
}): Promise<CallbackResult> {
    const provider = connectProvider(args.providerId);
    if (!provider) return { ok: false, error: 'Unknown sign-in provider' };
    const client = clientFor(provider.id, args.env ?? process.env);
    if (!client) return { ok: false, error: `${provider.title} sign-in is not set up on this server` };
    const flow = unseal(args.cookie, client);
    // The cookie is httpOnly and SameSite=Lax, set by this server when this
    // browser started the flow: a callback without it was not started here.
    if (!flow || flow.provider !== provider.id) return { ok: false, error: 'This sign-in was not started in this browser' };
    if ((args.now ?? Date.now()) > flow.exp) return { ok: false, nonce: flow.nonce, error: 'This sign-in took too long; try again' };
    const state = args.query.get('state') ?? '';
    const stateMatches = state.length === flow.state.length && timingSafeEqual(Buffer.from(state), Buffer.from(flow.state));
    if (!stateMatches) return { ok: false, nonce: flow.nonce, error: 'This sign-in was not started in this browser' };
    if (args.query.get('error')) {
        return { ok: false, nonce: flow.nonce, error: args.query.get('error') === 'access_denied' ? 'Sign-in was cancelled' : 'The provider refused the sign-in' };
    }
    const code = args.query.get('code');
    if (!code) return { ok: false, nonce: flow.nonce, error: 'The provider sent no authorization code' };

    let payload: { access_token?: unknown; expires_in?: unknown; scope?: unknown; token_type?: unknown };
    try {
        const response = await (args.fetch ?? fetch)(ENDPOINTS[provider.id].token, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                client_id: client.id,
                client_secret: client.secret,
                redirect_uri: args.redirectUri,
                code_verifier: flow.verifier
            }).toString(),
            redirect: 'error',
            signal: AbortSignal.timeout(15_000)
        });
        // The provider's error body can echo the client id; none of it is passed on.
        if (!response.ok) return { ok: false, nonce: flow.nonce, error: `The provider refused the code (HTTP ${response.status})` };
        payload = await response.json() as typeof payload;
    } catch {
        return { ok: false, nonce: flow.nonce, error: 'Could not reach the provider to finish signing in' };
    }
    if (typeof payload.access_token !== 'string' || payload.access_token.length === 0 || payload.access_token.length > 4096) {
        return { ok: false, nonce: flow.nonce, error: 'The provider sent no access token' };
    }
    if (typeof payload.token_type === 'string' && payload.token_type.toLowerCase() !== 'bearer') {
        return { ok: false, nonce: flow.nonce, error: 'The provider sent a token Flyspace cannot use' };
    }
    // A person can untick a scope on the consent screen. Without all of them
    // the block would fail later with a refusal that does not say why.
    const granted = new Set(typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : []);
    const missing = flow.scopes.filter(scope => !granted.has(scope));
    if (missing.length > 0) return { ok: false, nonce: flow.nonce, error: `Access was not granted for: ${missing.join(', ')}` };
    const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in > 0 ? Math.min(payload.expires_in, 24 * 3600) : 3600;
    return { ok: true, providerId: provider.id, nonce: flow.nonce, scopes: flow.scopes, accessToken: payload.access_token, expiresIn };
}

/**
 * The callback page: hands the outcome to the page that started the sign-in
 * over a BroadcastChannel (same origin only, and unlike window.opener it
 * survives the provider's Cross-Origin-Opener-Policy), then closes. The
 * starting page accepts only its own nonce. The one inline script is allowed
 * by hash, and nothing else loads.
 */
export function callbackPage(result: CallbackResult): { html: string; csp: string } {
    const message = result.ok
        ? { type: 'flyspace-connect', ok: true, provider: result.providerId, nonce: result.nonce, scopes: result.scopes, accessToken: result.accessToken, expiresIn: result.expiresIn }
        : { type: 'flyspace-connect', ok: false, nonce: result.nonce ?? null, error: result.error };
    // JSON inside a script: escape what could end it or start markup.
    const data = JSON.stringify(message).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    const script = `(function(){var m=${data};var s=document.getElementById('s');try{var c=new BroadcastChannel(${JSON.stringify(CONNECT_CHANNEL)});c.postMessage(m);c.close();}catch(e){}s.textContent=m.ok?'Signed in. You can close this window.':m.error;if(m.ok){setTimeout(function(){window.close();},300);}})();`;
    const hash = createHash('sha256').update(script).digest('base64');
    const text = result.ok ? 'Signed in. Returning to Flyspace…' : 'Sign-in did not finish.';
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Flyspace sign-in</title></head><body><p id="s">${text}</p><script>${script}</script></body></html>`;
    const csp = `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
    return { html, csp };
}
