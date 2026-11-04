import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { canonicalCapabilityId, credentialSlot } from './identity';
import { sealManifest, type CapabilityManifest } from './manifest';
import { clearCapabilities, installProposal } from './registry';
import { bindLocalHandler, executeCapability, unbindLocalHandler } from './execute';
import { latestExecutionRecord } from './executionLedger';
import { capabilitySecrets } from './secrets';
import { MAX_ERROR_MESSAGE, redact } from './redact';

// Characters that change under each encoding: + / = & space.
const SECRET = 'Sk+live/Q9=z&t ok-7781';
const BASIC = 'board-user:p@ss+w/rd=1';

function base64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64');
}

/** Every form an upstream might echo the credential back in. */
function forms(secret: string): string[] {
    const b64 = base64(secret);
    const pct = encodeURIComponent(secret);
    return [
        secret,
        b64,
        b64.replace(/=+$/, ''),
        b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
        pct,
        pct.replace(/%[0-9A-F]{2}/g, hex => hex.toLowerCase()),
        new URLSearchParams({ k: secret }).toString().slice(2)
    ];
}

function echo(secret: string): string {
    const all = forms(secret);
    return `upstream said: raw=${all[0]} Authorization: Bearer ${all[0]} Basic ${all[1]} `
        + `nopad=${all[2]} url-safe=${all[3]} ?key=${all[4]} lower=${all[5]} form=${all[6]}`;
}

function expectClean(text: string, secret: string) {
    for (const form of forms(secret)) expect(text).not.toContain(form);
}

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    unbindLocalHandler('board.search');
});

describe('redact', () => {
    it('removes the raw, prefixed, base64 and URL-encoded forms', () => {
        const text = redact(echo(SECRET), SECRET);
        expectClean(text, SECRET);
        expect(text).toContain('[redacted]');
        expect(text).toContain('Bearer [redacted]');
    });

    it('caps the length of what it returns', () => {
        expect(redact('x'.repeat(5_000)).length).toBeLessThanOrEqual(MAX_ERROR_MESSAGE + 1);
    });

    it('redacts short secrets too', () => {
        expectClean(redact('key was abc and YWJj', 'abc'), 'abc');
    });
});

function readSpec(security: Record<string, unknown>) {
    return {
        openapi: '3.0.3',
        info: { title: 'Board', version: '1' },
        servers: [{ url: 'https://board.example.test/v1' }],
        components: { securitySchemes: { Cred: security } },
        security: [{ Cred: [] }],
        paths: {
            '/items': {
                get: {
                    operationId: 'list',
                    responses: { '200': { description: 'items', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } }
                }
            }
        }
    };
}

function installRead(security: Record<string, unknown>, secret: string): CapabilityManifest {
    const manifest = compileOpenApi(readSpec(security)).manifests[0];
    if (manifest.transport.kind !== 'http') throw new Error('expected http');
    expect(installProposal(manifest).ok).toBe(true);
    capabilitySecrets.set(credentialSlot(manifest.transport.baseUrl, manifest.auth), secret);
    return manifest;
}

async function expectCleanRun(manifest: CapabilityManifest, secret: string, input: Record<string, unknown> = {}) {
    const result = await executeCapability(manifest.id, input);
    expect(result.ok).toBe(false);
    expectClean(JSON.stringify(result), secret);
    expectClean(JSON.stringify(latestExecutionRecord(manifest.id)?.receipt ?? null), secret);
    return result;
}

describe('dispatched-call errors carry no credential', () => {
    it.each([
        ['bearer', { type: 'http', scheme: 'bearer' }, SECRET],
        ['basic', { type: 'http', scheme: 'basic' }, BASIC],
        ['api key in query', { type: 'apiKey', in: 'query', name: 'key' }, SECRET],
        ['api key in header', { type: 'apiKey', in: 'header', name: 'X-Api-Key' }, SECRET]
    ])('browser_direct, %s', async (_label, security, secret) => {
        const manifest = installRead(security, secret);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(echo(secret)); }));
        const result = await expectCleanRun(manifest, secret);
        expect(result.error?.code).toBe('UPSTREAM_ERROR');
    });

    it('local', async () => {
        const transport = { kind: 'local' as const, handler: 'board.search' };
        const secretRef = 'cred_board_fixture';
        const installed = installProposal(sealManifest({
            version: 1,
            id: canonicalCapabilityId(transport),
            title: 'Search',
            source: { kind: 'bring', locator: 'fixture://board', operationId: 'search' },
            effect: 'read',
            effectSource: 'annotation',
            approval: 'auto',
            invocation: 'manual',
            trigger: { kind: 'manual' },
            auth: { kind: 'apiKey', in: 'header', name: 'x-api-key', secretRef },
            transport,
            inputs: [],
            output: { schema: { kind: 'array', items: { kind: 'string' } }, presentation: 'raw' }
        }));
        expect(installed.ok, installed.errors.join('; ')).toBe(true);
        capabilitySecrets.set(secretRef, SECRET);
        bindLocalHandler('board.search', async () => { throw new Error(echo(SECRET)); });
        await expectCleanRun(installed.manifest!, SECRET);
    });
});
