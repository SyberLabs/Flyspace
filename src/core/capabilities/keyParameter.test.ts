import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isKeyParameter } from './credentialName';
import { credentialSlot } from './identity';
import { MAX_AUTH_HINT, validateManifest } from './manifest';
import { compileOpenApi } from './openapi';
import { clearCapabilities, installProposal, runInstalledCapability } from './registry';
import { capabilitySecrets } from './secrets';
import { useBlockStore } from '@/core/stores/blockStore';
import { blockRegistry } from '@/core/registry/BlockRegistry';

const INTERZOID_HINT = 'Your Interzoid license API key. Register at www.interzoid.com/register';

// Interzoid's "Get Weather City", as the directory serves it: no security
// scheme, and the key passed as an ordinary required query parameter.
function interzoid(extra: { security?: unknown; components?: unknown; parameters?: unknown[] } = {}) {
    return {
        openapi: '3.0.0',
        info: { title: 'Get Weather City', version: '1.0.0' },
        servers: [{ url: 'https://api.interzoid.com' }],
        ...(extra.security ? { security: extra.security } : {}),
        ...(extra.components ? { components: extra.components } : {}),
        paths: {
            '/getweather': {
                get: {
                    summary: 'Gets current weather information for a US city and state',
                    parameters: extra.parameters ?? [
                        { name: 'license', in: 'query', required: true, description: INTERZOID_HINT, schema: { type: 'string' } },
                        { name: 'city', in: 'query', required: true, description: 'City for weather information', schema: { type: 'string' } },
                        { name: 'state', in: 'query', required: true, description: 'State for weather information', schema: { type: 'string' } }
                    ],
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
                }
            }
        }
    };
}

describe('isKeyParameter', () => {
    it.each([
        ['api_key', 'query', '', true],
        ['apiKey', 'query', '', true],
        ['X-API-Key', 'header', '', true],
        ['Ocp-Apim-Subscription-Key', 'header', '', true],
        ['license', 'query', INTERZOID_HINT, true],
        ['key', 'query', 'API key. Your API key identifies your project and provides you with API access.', true],
        ['token', 'query', 'Your API token, from the account page', true],
        ['license', 'query', '', false], // a name alone is not enough
        ['license', 'query', 'SPDX license of the repository', false],
        ['key', 'query', 'The cache key to look up', false],
        ['token', 'query', 'Pagination token from the previous response', false],
        ['page_token', 'query', 'Your next page token', false],
        ['api_key', 'path', '', false], // a path segment is part of the URL, not a credential slot
        ['city', 'query', 'Register at the city office', false]
    ])('%s in %s, "%s" → %s', (name, location, description, expected) => {
        expect(isKeyParameter({ name, in: location, description })).toBe(expected);
    });
});

describe('a key passed as a parameter becomes the API key', () => {
    it('compiles Interzoid\'s license into a query key with the spec\'s own words, and takes it off the inputs', () => {
        const { manifests, errors } = compileOpenApi(interzoid());
        expect(errors).toEqual([]);
        const manifest = manifests[0];
        expect(manifest.inputs.map(input => input.name)).toEqual(['city', 'state']);
        expect(manifest.auth).toEqual({
            kind: 'apiKey',
            in: 'query',
            name: 'license',
            secretRef: credentialSlot('https://api.interzoid.com', { kind: 'apiKey', in: 'query', name: 'license' }),
            hint: INTERZOID_HINT
        });
        expect(validateManifest(manifest).ok).toBe(true);
    });

    it('leaves the parameter alone when the spec declares its own scheme', () => {
        const manifest = compileOpenApi(interzoid({
            security: [{ bearer: [] }],
            components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }
        })).manifests[0];
        expect(manifest.auth.kind).toBe('bearer');
        expect(manifest.inputs.map(input => input.name)).toContain('license');
    });

    it('leaves two key-like parameters as inputs, since one slot cannot hold both', () => {
        const manifest = compileOpenApi(interzoid({
            parameters: [
                { name: 'api_key', in: 'query', required: true, schema: { type: 'string' } },
                { name: 'app_key', in: 'query', required: true, schema: { type: 'string' } }
            ]
        })).manifests[0];
        expect(manifest.auth.kind).toBe('none');
        expect(manifest.inputs.map(input => input.name)).toEqual(['api_key', 'app_key']);
    });

    it('refuses a hint on a scheme that takes no key, and an overlong hint', () => {
        const manifest = compileOpenApi(interzoid()).manifests[0];
        const long = { ...manifest, auth: { ...manifest.auth, hint: 'x'.repeat(MAX_AUTH_HINT + 1) } };
        expect(validateManifest(long).errors).toContain(`auth.hint must be at most ${MAX_AUTH_HINT} characters`);
        const none = compileOpenApi(interzoid({ parameters: [] })).manifests[0];
        expect(validateManifest({ ...none, auth: { kind: 'none', hint: 'hi' } }).errors).toContain('only a key, bearer, or basic auth carries a hint');
    });
});

describe('running a block whose key came from a parameter', () => {
    let requests: string[];

    beforeEach(() => {
        clearCapabilities();
        capabilitySecrets.clear();
        useBlockStore.setState({ blocks: [] });
        requests = [];
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            requests.push(String(input));
            return new Response('{"Weather":"Light rain"}', { status: 200, headers: { 'content-type': 'application/json' } });
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        clearCapabilities();
        capabilitySecrets.clear();
        useBlockStore.setState({ blocks: [] });
    });

    it('sends the key from the session store, not from the block', async () => {
        const manifest = compileOpenApi(interzoid()).manifests[0];
        expect(installProposal(manifest).ok).toBe(true);
        capabilitySecrets.set(manifest.auth.secretRef!, 'session-license');
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get(manifest.id)!, { x: 0, y: 0 });

        await runInstalledCapability(instanceId, { city: 'Seattle', state: 'WA' });

        const url = new URL(requests[0]);
        expect(url.origin).toBe('https://api.interzoid.com');
        expect(url.searchParams.get('license')).toBe('session-license');
        expect(url.searchParams.get('city')).toBe('Seattle');
        expect(JSON.stringify(useBlockStore.getState().blocks)).not.toContain('session-license');
    });
});
