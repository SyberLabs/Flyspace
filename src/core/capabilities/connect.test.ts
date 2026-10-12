import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectSignIn, signInSlotOf, type ConnectDeps } from './connect';
import { credentialSlot } from './identity';
import { sealManifest, type CapabilityManifest } from './manifest';
import { compileOpenApi } from './openapi';
import { capabilitySecrets } from './secrets';

const READ = 'https://www.googleapis.com/auth/calendar.readonly';
const NONCE = 'n'.repeat(32);

function calendarGet(): CapabilityManifest {
    const scopes = { [READ]: 'read' };
    const [manifest] = compileOpenApi({
        openapi: '3.0.0',
        info: { title: 'Calendar', version: 'v3' },
        servers: [{ url: 'https://www.googleapis.com/calendar/v3' }],
        components: { securitySchemes: { Oauth2c: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: 'https://accounts.google.com/o/oauth2/auth', tokenUrl: 'https://oauth2.googleapis.com/token', scopes } } } } },
        paths: { '/colors': { get: { operationId: 'calendar.colors.get', security: [{ Oauth2c: [READ] }], responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } } } } }
    }).manifests;
    return manifest;
}

/** A channel the test can speak on, standing in for the callback page. */
function fakeChannel() {
    const channel: { onmessage: ((event: MessageEvent) => void) | null; close: () => void; closed: boolean } = {
        onmessage: null,
        closed: false,
        close() { this.closed = true; }
    };
    const say = (data: unknown) => channel.onmessage?.({ data } as MessageEvent);
    return { channel, say };
}

function deps(channel: ReturnType<typeof fakeChannel>['channel'], opened: string[] = []): ConnectDeps {
    return {
        open: url => { opened.push(url); return {}; },
        channel: () => channel as unknown as BroadcastChannel,
        nonce: () => NONCE
    };
}

const granted = { type: 'flyspace-connect', ok: true, provider: 'google', nonce: NONCE, scopes: [READ], accessToken: 'ya29.token', expiresIn: 3600 };

beforeEach(() => capabilitySecrets.clear());
afterEach(() => {
    vi.useRealTimers();
    capabilitySecrets.clear();
});

describe('signing in from the browser', () => {
    it('knows the slot and scopes of a Google manifest, and offers nothing for one re-pointed elsewhere', () => {
        const manifest = calendarGet();
        expect(signInSlotOf(manifest)).toMatchObject({ slot: manifest.auth.secretRef, scopes: [READ] });
        if (manifest.transport.kind !== 'http') throw new Error('expected http');
        const elsewhere = sealManifest({
            ...manifest,
            transport: { ...manifest.transport, baseUrl: 'https://collector.example.test' },
            auth: { ...manifest.auth, secretRef: credentialSlot('https://collector.example.test', manifest.auth) }
        });
        expect(signInSlotOf(elsewhere)).toBeNull();
    });

    it('opens the start URL for its scopes, ignores other nonces, and keeps the token in the slot', async () => {
        const manifest = calendarGet();
        const { channel, say } = fakeChannel();
        const opened: string[] = [];
        const outcome = connectSignIn(manifest, deps(channel, opened));
        expect(opened[0]).toBe(`/api/oauth/google/start?nonce=${NONCE}&scope=${encodeURIComponent(READ)}`);
        say({ ...granted, nonce: 'someone-else', accessToken: 'not-mine' });
        say(granted);
        await expect(outcome).resolves.toEqual({ ok: true });
        expect(capabilitySecrets.get(manifest.auth.secretRef!)).toBe('ya29.token');
        // The device vault is never offered a sign-in token.
        expect(capabilitySecrets.refs()).not.toContain(manifest.auth.secretRef);
        expect(channel.closed).toBe(true);
    });

    it('refuses a token for other scopes', async () => {
        const manifest = calendarGet();
        const { channel, say } = fakeChannel();
        const outcome = connectSignIn(manifest, deps(channel));
        say({ ...granted, scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
        await expect(outcome).resolves.toEqual({ ok: false, error: 'The sign-in answered for something else' });
        expect(capabilitySecrets.has(manifest.auth.secretRef!)).toBe(false);
    });

    it('says so when the window is blocked', async () => {
        const { channel } = fakeChannel();
        const outcome = await connectSignIn(calendarGet(), { ...deps(channel), open: () => null });
        expect(outcome).toMatchObject({ ok: false, error: expect.stringMatching(/blocked/) });
    });

    it('drops the token a minute before it expires, so the block asks again', async () => {
        vi.useFakeTimers();
        const manifest = calendarGet();
        const { channel, say } = fakeChannel();
        const outcome = connectSignIn(manifest, deps(channel));
        say({ ...granted, expiresIn: 600 });
        await outcome;
        vi.advanceTimersByTime(539_000);
        expect(capabilitySecrets.has(manifest.auth.secretRef!)).toBe(true);
        vi.advanceTimersByTime(2_000);
        expect(capabilitySecrets.has(manifest.auth.secretRef!)).toBe(false);
    });
});
