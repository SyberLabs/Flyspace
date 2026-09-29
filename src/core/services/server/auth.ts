import 'server-only';

import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';

export interface AuthenticatedIdentity {
    ownerId: string | null;
}

type AuthResult =
    | { identity: AuthenticatedIdentity; response?: never }
    | { identity?: never; response: NextResponse };

class AuthConfigurationError extends Error {}

const discoveryCache = new Map<string, Promise<ReturnType<typeof createRemoteJWKSet>>>();

function jsonError(status: number, error: string): AuthResult {
    return { response: NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } }) };
}

async function keySetFor(issuer: string): Promise<ReturnType<typeof createRemoteJWKSet>> {
    let pending = discoveryCache.get(issuer);
    if (!pending) {
        pending = (async () => {
            const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
            const response = await fetch(discoveryUrl, {
                cache: 'no-store',
                signal: AbortSignal.timeout(4_000)
            });
            if (!response.ok) throw new AuthConfigurationError('OIDC discovery failed');
            const metadata = await response.json() as { issuer?: string; jwks_uri?: string };
            if (metadata.issuer !== issuer || !metadata.jwks_uri) {
                throw new AuthConfigurationError('OIDC discovery does not match configured issuer');
            }
            const jwksUrl = new URL(metadata.jwks_uri);
            if (jwksUrl.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && jwksUrl.hostname === '127.0.0.1')) {
                throw new AuthConfigurationError('OIDC signing keys must use HTTPS');
            }
            return createRemoteJWKSet(jwksUrl, { timeoutDuration: 4_000 });
        })();
        discoveryCache.set(issuer, pending);
    }
    try {
        return await pending;
    } catch (error) {
        discoveryCache.delete(issuer);
        throw error;
    }
}

/** Verify an OIDC bearer token; identity headers are never trusted. */
export async function authenticateApiRequest(request: Request): Promise<AuthResult> {
    if (!hostedAuthRequired()) return { identity: { ownerId: null } };

    const issuer = process.env.OMNI_AUTH_ISSUER?.trim();
    const audience = process.env.OMNI_AUTH_AUDIENCE?.trim();
    if (!issuer || !audience) {
        return jsonError(503, 'Hosted authentication is not configured');
    }
    let issuerUrl: URL;
    try {
        issuerUrl = new URL(issuer);
    } catch {
        return jsonError(503, 'Hosted authentication is not configured');
    }
    if (issuerUrl.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && issuerUrl.hostname === '127.0.0.1')) {
        return jsonError(503, 'Hosted authentication issuer must use HTTPS');
    }

    const authorization = request.headers.get('authorization');
    const token = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) return jsonError(401, 'Authentication required');

    try {
        const keySet = await keySetFor(issuer);
        const { payload } = await jwtVerify(token, keySet, {
            issuer,
            audience,
            algorithms: ['RS256', 'ES256'],
            requiredClaims: ['sub', 'iat', 'exp'],
            maxTokenAge: '5m',
            clockTolerance: '30s'
        });
        if (typeof payload.sub !== 'string' || !payload.sub.trim()) {
            return jsonError(401, 'Invalid authentication token');
        }
        return { identity: { ownerId: `${issuer}:${payload.sub}` } };
    } catch (error) {
        if (error instanceof AuthConfigurationError || error instanceof errors.JWKSTimeout) {
            console.error('[auth] identity provider unavailable or misconfigured');
            return jsonError(503, 'Identity provider unavailable');
        }
        return jsonError(401, 'Invalid authentication token');
    }
}

export function hostedAuthRequired(): boolean {
    const mode = process.env.OMNI_DEPLOYMENT_MODE?.trim().toLowerCase();
    return mode !== 'local' && (process.env.NODE_ENV === 'production' || mode === 'hosted');
}
