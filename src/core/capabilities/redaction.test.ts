import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { canonicalCapabilityId, credentialSlot, transportCredentialSlot } from './identity';
import { sealManifest, type CapabilityManifest } from './manifest';
import { admitProposal } from './admission';
import { approveCapability, clearCapabilities, installProposal } from './registry';
import { bindMcpTransport, executeCapability, previewCapabilityRun, unbindMcpTransport } from './execute';
import { AsyncStartRejected, bindAsyncRuntime, unbindAsyncRuntime } from './asyncRuntime';
import { latestExecutionRecord } from './executionLedger';
import { capabilitySecrets } from './secrets';
import { MAX_ERROR_MESSAGE, redact } from './redact';
import type { CapabilityProposalV1 } from './provider';
import { handleCapabilityBroker, createBrokerRateLimiter } from '../services/server/capabilityBroker';
import { memoryLedger, type ServerLedger } from '../services/server/capability.ledger';

const NOW = 1_790_000_000_000;
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
    unbindMcpTransport('board');
    unbindAsyncRuntime('jobs');
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

function installRead(security: Record<string, unknown>, secret: string, access: 'browser_direct' | 'server_broker' = 'browser_direct'): CapabilityManifest {
    const compiled = compileOpenApi(readSpec(security)).manifests[0];
    if (compiled.transport.kind !== 'http') throw new Error('expected http');
    const transport = { ...compiled.transport, access };
    const manifest = sealManifest({ ...compiled, id: canonicalCapabilityId(transport), transport });
    expect(installProposal(manifest).ok).toBe(true);
    capabilitySecrets.set(credentialSlot(transport.baseUrl, manifest.auth), secret);
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

    it('server_broker as seen by the browser', async () => {
        const manifest = installRead({ type: 'http', scheme: 'bearer' }, SECRET, 'server_broker');
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            error: { code: 'UPSTREAM_ERROR', message: echo(SECRET) }
        }), { status: 502, headers: { 'content-type': 'application/json' } })));
        await expectCleanRun(manifest, SECRET);
    });

    it('mcp', async () => {
        const proposal: CapabilityProposalV1 = {
            version: 1,
            provider: { id: 'fixture.mcp', kind: 'mcp' },
            externalIdentity: { operationId: 'search', sourceLocator: 'fixture://mcp/board' },
            title: 'Search',
            effectHint: 'read',
            auth: { kind: 'apiKey', in: 'header', name: 'x-api-key' },
            transport: { kind: 'mcp', serverId: 'board', origin: 'https://board.example.test', toolName: 'search' },
            inputs: [],
            output: { schema: { kind: 'array', items: { kind: 'string' } }, presentation: 'raw' },
            execution: { kind: 'sync' },
            provenance: { providerId: 'fixture.mcp', sourceLocator: 'fixture://mcp/board', discoveredAtMs: NOW }
        };
        const installed = admitProposal(proposal, { nowMs: NOW, trustedEffectHints: { mcpServers: ['board'] } });
        expect(installed.ok, installed.errors.join('; ')).toBe(true);
        const manifest = installed.manifest!;
        capabilitySecrets.set(transportCredentialSlot(manifest.transport, manifest.auth)!, SECRET);
        bindMcpTransport('board', { origin: 'https://board.example.test', call: async () => { throw new Error(echo(SECRET)); } });
        await expectCleanRun(manifest, SECRET);
    });

    it('async', async () => {
        const proposal: CapabilityProposalV1 = {
            version: 1,
            provider: { id: 'fixture.jobs', kind: 'manual' },
            externalIdentity: { operationId: 'robot-1', sourceLocator: 'fixture://jobs/robot-1' },
            title: 'Scrape',
            auth: { kind: 'apiKey', in: 'header', name: 'x-api-key' },
            transport: { kind: 'async', runtimeId: 'jobs', operation: 'robot-1' },
            inputs: [],
            output: { schema: { kind: 'object', properties: { markdown: { kind: 'string' } }, required: ['markdown'] }, presentation: 'raw' },
            execution: { kind: 'async_poll', pollIntervalMs: 5_000, maxDurationMs: 120_000 },
            provenance: { providerId: 'fixture.jobs', sourceLocator: 'fixture://jobs/robot-1', discoveredAtMs: NOW }
        };
        const installed = admitProposal(proposal, { nowMs: NOW });
        expect(installed.ok, installed.errors.join('; ')).toBe(true);
        const manifest = approveCapability(installed.manifest!.id).manifest!;
        capabilitySecrets.set(transportCredentialSlot(manifest.transport, manifest.auth)!, SECRET);
        bindAsyncRuntime('jobs', {
            start: async () => { throw new AsyncStartRejected(echo(SECRET)); },
            poll: async () => ({ status: 'running' })
        });
        const preview = previewCapabilityRun(manifest.id, {});
        if (!preview.ok) throw new Error('preview failed');
        const result = await executeCapability(manifest.id, {}, { confirmedRun: preview.preview.digest });
        expect(result.error?.code).toBe('ASYNC_START_REJECTED');
        expectClean(JSON.stringify(result), SECRET);
        expectClean(JSON.stringify(latestExecutionRecord(manifest.id)?.receipt ?? null), SECRET);
    });
});

describe('server broker error handling', () => {
    function brokerManifest() {
        const compiled = compileOpenApi(readSpec({ type: 'http', scheme: 'bearer' })).manifests[0];
        if (compiled.transport.kind !== 'http') throw new Error('expected http');
        return sealManifest({ ...compiled, transport: { ...compiled.transport, access: 'server_broker' } });
    }

    function spiedLedger(): { ledger: ServerLedger; finished: unknown[][] } {
        const inner = memoryLedger();
        const finished: unknown[][] = [];
        return {
            finished,
            ledger: {
                ...inner,
                finish: async (...args) => {
                    finished.push(args);
                    return inner.finish(...args);
                }
            }
        };
    }

    it.each([
        ['a transport error', async () => { throw new Error(echo(SECRET)); }],
        ['an HTTP error whose body echoes it', async () => ({ status: 500, headers: {}, text: echo(SECRET) })],
        ['a success body that is not JSON', async () => ({ status: 200, headers: {}, text: echo(SECRET) })]
    ])('records a code and returns no credential for %s', async (_label, fetch) => {
        const { ledger, finished } = spiedLedger();
        const result = await handleCapabilityBroker({
            manifest: brokerManifest(),
            input: {},
            idempotencyKey: 'broker-key-redact',
            secret: SECRET
        }, {
            ledger,
            resolve: async () => ['1.1.1.1'],
            fetch,
            limiter: createBrokerRateLimiter()
        });
        expect(result.status).toBe(502);
        expectClean(JSON.stringify(result.body), SECRET);
        expect(finished).toHaveLength(1);
        expectClean(JSON.stringify(finished), SECRET);
        expect(finished[0][2]).toMatch(/^[A-Z_]+$/);
    });
});
