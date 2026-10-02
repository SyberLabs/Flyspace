import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { canonicalCapabilityId, credentialSlot } from './identity';
import { sealManifest, type CapabilityInput, type CapabilityManifest } from './manifest';
import { clearCapabilities, installProposal } from './registry';
import { executeCapability, previewCapabilityRun } from './execute';
import { capabilitySecrets } from './secrets';

// A fixture value, not a credential.
const TOKEN = 'fixture-token-0001';

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

/** A read whose manifest also declares `inputs`, with the credential in its slot. */
function installRead(security: Record<string, unknown>, inputs: CapabilityInput[]): CapabilityManifest {
    const compiled = compileOpenApi(readSpec(security)).manifests[0];
    if (compiled.transport.kind !== 'http') throw new Error('expected http');
    const transport = { ...compiled.transport, access: 'browser_direct' as const };
    const manifest = sealManifest({ ...compiled, id: canonicalCapabilityId(transport), transport, inputs });
    const installed = installProposal(manifest);
    expect(installed.ok, installed.errors?.join('; ')).toBe(true);
    capabilitySecrets.set(credentialSlot(transport.baseUrl, manifest.auth), TOKEN);
    return manifest;
}

function stringInput(name: string, placement: 'header' | 'query'): CapabilityInput {
    return { name, in: placement, required: false, schema: { kind: 'string' } };
}

const BEARER = { type: 'http', scheme: 'bearer' };
const API_KEY_HEADER = { type: 'apiKey', in: 'header', name: 'X-Api-Key' };
const API_KEY_QUERY = { type: 'apiKey', in: 'query', name: 'api_key' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('["ok"]', {
        status: 200,
        headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    capabilitySecrets.clear();
});

describe('an input never replaces or shadows the credential', () => {
    it.each([
        ['bearer, same spelling', BEARER, stringInput('Authorization', 'header')],
        ['bearer, other case', BEARER, stringInput('authorization', 'header')],
        ['basic', { type: 'http', scheme: 'basic' }, stringInput('AUTHORIZATION', 'header')],
        ['an apiKey header in another case', API_KEY_HEADER, stringInput('x-api-key', 'header')]
    ])('refuses a value for an input in the credential\'s place (%s)', async (_label, security, input) => {
        const manifest = installRead(security, [input]);
        const supplied = { [input.name]: 'caller-chosen' };
        const preview = previewCapabilityRun(manifest.id, supplied);
        expect(preview.ok).toBe(false);
        if (!preview.ok) expect(preview.result.error?.code).toBe('INPUT_INVALID');
        const result = await executeCapability(manifest.id, supplied);
        expect(result.error?.code).toBe('INPUT_INVALID');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends exactly one credential header, the slot\'s own, when the colliding input is left empty', async () => {
        const manifest = installRead(BEARER, [stringInput('authorization', 'header'), stringInput('X-Trace', 'header')]);
        const result = await executeCapability(manifest.id, { 'X-Trace': 't-1' });
        expect(result.ok, result.error?.message).toBe(true);
        const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as Record<string, string>);
        expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
        expect(headers.get('x-trace')).toBe('t-1');
    });

    it('an input with the apiKey placement\'s exact name is refused at install, as before', () => {
        const compiled = compileOpenApi(readSpec(API_KEY_QUERY)).manifests[0];
        const manifest = sealManifest({ ...compiled, inputs: [stringInput('api_key', 'query')] });
        expect(installProposal(manifest).ok).toBe(false);
    });

    it('still lets an input use a header the credential does not occupy', async () => {
        const manifest = installRead(API_KEY_HEADER, [stringInput('Authorization', 'header')]);
        const result = await executeCapability(manifest.id, { Authorization: 'Token other' });
        expect(result.ok, result.error?.message).toBe(true);
        const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as Record<string, string>);
        expect(headers.get('x-api-key')).toBe(TOKEN);
        expect(headers.get('authorization')).toBe('Token other');
    });
});
