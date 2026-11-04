import { describe, expect, it, vi } from 'vitest';
import { buildApiIndexEntries, credentialNeedOf, parseApiIndex } from './apiIndex';
import { CURATED_APIS, curatedApi } from './curatedApis';
import { ALPHA_VANTAGE_SPEC } from './curated/alphaVantage';
import { compileOpenApi } from './openapi';
import { fetchCatalogSpec, RegistryFetchError } from './registrySearch';

const ALPHA = curatedApi('omni:alpha-vantage')!;

describe('Alpha Vantage, as Flyspace ships it', () => {
    const { manifests, errors } = compileOpenApi(ALPHA.spec, { sourceLocator: ALPHA.entry.specUrl });

    it('compiles to the one read its entry claims, called from the browser', () => {
        expect(errors).toEqual([]);
        expect(manifests).toHaveLength(ALPHA.entry.operations!);
        for (const manifest of manifests) {
            expect(manifest.effect).toBe('read');
            expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('browser_direct');
            expect(manifest.transport.kind === 'http' && manifest.transport.baseUrl).toBe('https://www.alphavantage.co');
        }
    });

    it('asks for the key once, in the query where Alpha Vantage reads it, with where to get one', () => {
        const slots = new Set(manifests.map(m => m.auth.secretRef));
        expect(slots.size).toBe(1);
        expect(manifests[0].auth).toMatchObject({ kind: 'apiKey', in: 'query', name: 'apikey' });
        expect(manifests[0].auth.hint).toContain('https://www.alphavantage.co/support/#api-key');
    });

    it('requires the function and the symbol every query needs', () => {
        const query = manifests.find(m => m.source.operationId === 'query')!;
        expect(query.inputs.find(i => i.name === 'function')).toMatchObject({ required: true, schema: { enum: ['GLOBAL_QUOTE', 'TIME_SERIES_DAILY', 'TIME_SERIES_MONTHLY'] } });
        expect(query.inputs.find(i => i.name === 'symbol')).toMatchObject({ required: true, example: 'MSFT' });
    });
});

describe('a curated entry', () => {
    it('serves its spec from the bundle, without a fetch', async () => {
        const fetchImpl = vi.fn();
        const document = await fetchCatalogSpec(ALPHA.entry, { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(document).toEqual(ALPHA_VANTAGE_SPEC);
        expect(document).not.toBe(ALPHA_VANTAGE_SPEC); // a copy: nothing downstream can change the shipped spec
    });

    it('cannot be claimed by an entry the repo does not list', async () => {
        const forged = { ...ALPHA.entry, id: 'omni:not-shipped' };
        await expect(fetchCatalogSpec(forged, { fetchImpl: vi.fn() })).rejects.toBeInstanceOf(RegistryFetchError);
    });

    it('cannot appear in the built index', () => {
        const entry = buildApiIndexEntries({
            'example.com': {
                preferred: '1',
                versions: { 1: { swaggerUrl: 'https://api.apis.guru/v2/specs/example.com/1/openapi.json', openapiVer: '3.0.0', info: { title: 'Example' } } }
            }
        }).entries[0];
        const index = (entries: unknown[]) => ({
            format: 'omni-api-index', version: 1,
            source: { url: 'https://api.apis.guru/v2/list.json', license: 'CC0-1.0', etag: null, lastModified: null },
            builtAt: '2026-10-07T00:00:00.000Z', entries
        });
        expect(parseApiIndex(index([entry]))).not.toBeNull();
        expect(parseApiIndex(index([{ ...entry, curated: true }]))).toBeNull();
    });

    it('has ids no directory entry can take', () => {
        for (const api of CURATED_APIS) expect(api.entry.id.startsWith('omni:')).toBe(true);
    });
});

describe('every curated API', () => {
    it.each(CURATED_APIS.map(api => [api.entry.id, api] as const))('%s compiles to what its entry claims, called from the browser', (_id, api) => {
        const { manifests, errors } = compileOpenApi(api.spec, { sourceLocator: api.entry.specUrl });
        expect(errors).toEqual([]);
        expect(manifests).toHaveLength(api.entry.operations!);
        for (const manifest of manifests) {
            expect(manifest.effect).toBe('read');
            expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('browser_direct');
            if (manifest.auth.kind !== 'none') expect(manifest.auth.hint?.length ?? 0, api.entry.id).toBeGreaterThan(20); // says where to get the key
        }
    });

    it('needs no key for BLS', () => {
        const bls = compileOpenApi(curatedApi('omni:bls')!.spec).manifests[0];
        expect(bls.auth.kind).toBe('none');
    });
});

describe('an http auth scheme that names a static token', () => {
    const spec = (scheme: string) => ({
        openapi: '3.0.0', info: { title: 'T', version: '1' }, servers: [{ url: 'https://api.example.test' }],
        security: [{ s: [] }], components: { securitySchemes: { s: { type: 'http', scheme } } },
        paths: { '/x': { get: { responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } } } } }
    });

    it('becomes a key in Authorization under that scheme name', () => {
        expect(compileOpenApi(spec('Token')).manifests[0].auth).toMatchObject({ kind: 'apiKey', name: 'Authorization', prefix: 'Token ' });
        expect(compileOpenApi(spec('ApiKey')).manifests[0].auth).toMatchObject({ prefix: 'ApiKey ' });
    });

    it('is refused for a challenge scheme a pasted key cannot answer', () => {
        expect(compileOpenApi(spec('Digest')).manifests).toEqual([]);
        expect(compileOpenApi(spec('Negotiate')).manifests).toEqual([]);
    });
});

describe('a curated entry says what it needs to run', () => {
    it.each(CURATED_APIS.map(api => [api.entry.id, api] as const))('%s records the credential need its spec compiles to', (_id, api) => {
        const kinds = compileOpenApi(api.spec).manifests.map(m => m.auth.kind);
        expect(api.entry.credential).toBe(credentialNeedOf(kinds));
    });
});
