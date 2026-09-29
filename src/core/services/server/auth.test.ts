import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { authenticateApiRequest } from './auth';

describe('hosted API authentication', () => {
    let server: Server;
    let issuer: string;
    let privateKey: CryptoKey;
    let jwk: JWK;
    const originalMode = process.env.OMNI_DEPLOYMENT_MODE;
    const originalIssuer = process.env.OMNI_AUTH_ISSUER;
    const originalAudience = process.env.OMNI_AUTH_AUDIENCE;

    beforeAll(async () => {
        const pair = await generateKeyPair('RS256');
        privateKey = pair.privateKey;
        jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', use: 'sig', alg: 'RS256' };
        server = createServer((request, response) => {
            if (request.url === '/.well-known/openid-configuration') {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({ issuer, jwks_uri: `${issuer.replace(/\/$/, '')}/jwks` }));
            } else if (request.url === '/jwks') {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({ keys: [jwk] }));
            } else {
                response.statusCode = 404;
                response.end();
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('test issuer failed to bind');
        issuer = `http://127.0.0.1:${address.port}/`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        if (originalMode === undefined) delete process.env.OMNI_DEPLOYMENT_MODE;
        else process.env.OMNI_DEPLOYMENT_MODE = originalMode;
        if (originalIssuer === undefined) delete process.env.OMNI_AUTH_ISSUER;
        else process.env.OMNI_AUTH_ISSUER = originalIssuer;
        if (originalAudience === undefined) delete process.env.OMNI_AUTH_AUDIENCE;
        else process.env.OMNI_AUTH_AUDIENCE = originalAudience;
    });

    async function token(claims: { audience?: string; issuedAt?: number; expiry?: number | null; issuer?: string }) {
        let jwt = new SignJWT({})
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(claims.issuer ?? issuer)
            .setAudience(claims.audience ?? 'omni-api')
            .setSubject('alice');
        jwt = jwt.setIssuedAt(claims.issuedAt ?? Math.floor(Date.now() / 1000));
        if (claims.expiry !== null) jwt = jwt.setExpirationTime(claims.expiry ?? '2m');
        return jwt.sign(privateKey);
    }

    async function verify(jwt: string) {
        return authenticateApiRequest(new Request('http://omni.test/api/llm', {
            headers: { authorization: `Bearer ${jwt}`, 'x-user-id': 'attacker' }
        }));
    }

    beforeAll(() => {
        process.env.OMNI_DEPLOYMENT_MODE = 'hosted';
        process.env.OMNI_AUTH_ISSUER = issuer;
        process.env.OMNI_AUTH_AUDIENCE = 'omni-api';
    });

    it('derives owner from a verified subject and preserves exact issuer including trailing slash', async () => {
        const result = await verify(await token({}));
        expect(result.identity?.ownerId).toBe(`${issuer}:alice`);
        expect(result.response).toBeUndefined();
    });

    it('rejects tokens without expiration, with another API audience, or older than the token-age bound', async () => {
        expect((await verify(await token({ expiry: null }))).response?.status).toBe(401);
        expect((await verify(await token({ expiry: Math.floor(Date.now() / 1000) - 30 }))).response?.status).toBe(401);
        expect((await verify(await token({ audience: 'browser-client' }))).response?.status).toBe(401);
        expect((await verify(await token({ issuedAt: Math.floor(Date.now() / 1000) - 400 }))).response?.status).toBe(401);
        expect((await verify(await token({ issuer: 'http://127.0.0.1:1/forged' }))).response?.status).toBe(401);
        expect((await verify('not.a.jwt')).response?.status).toBe(401);
    });

    it('does not accept caller identity headers without a bearer token', async () => {
        const result = await authenticateApiRequest(new Request('http://omni.test/api/llm', {
            headers: { 'x-user-id': 'attacker' }
        }));
        expect(result.response?.status).toBe(401);
    });

    it('fails closed when hosted issuer or API audience configuration is absent', async () => {
        const saved = process.env.OMNI_AUTH_AUDIENCE;
        delete process.env.OMNI_AUTH_AUDIENCE;
        try {
            expect((await authenticateApiRequest(new Request('http://omni.test/api/llm'))).response?.status).toBe(503);
        } finally {
            process.env.OMNI_AUTH_AUDIENCE = saved;
        }
    });
});
