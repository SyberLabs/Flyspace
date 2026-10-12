import { afterEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { redirectUriFor } from './redirectUri';

const saved = process.env.OMNI_OAUTH_ORIGIN;
afterEach(() => {
    if (saved === undefined) delete process.env.OMNI_OAUTH_ORIGIN;
    else process.env.OMNI_OAUTH_ORIGIN = saved;
});

describe('the OAuth redirect URI', () => {
    it('stays on the host the browser used, where the flow cookie lives', () => {
        delete process.env.OMNI_OAUTH_ORIGIN;
        const request = new NextRequest('http://localhost:3000/api/oauth/google/start', { headers: { host: '127.0.0.1:3000' } });
        expect(redirectUriFor(request, 'google')).toBe('http://127.0.0.1:3000/api/oauth/google/callback');
    });

    it('uses the pinned origin when one is set', () => {
        process.env.OMNI_OAUTH_ORIGIN = 'https://flyspace.internal.example/';
        const request = new NextRequest('http://10.0.0.5:3000/api/oauth/google/start', { headers: { host: '10.0.0.5:3000' } });
        expect(redirectUriFor(request, 'google')).toBe('https://flyspace.internal.example/api/oauth/google/callback');
    });
});
