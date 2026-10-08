import { describe, expect, it, vi } from 'vitest';
import { buildApiIndexEntries, parseApiIndex } from './apiIndex';
import { CURATED_APIS, curatedApi } from './curatedApis';
import { FRED_SPEC } from './curated/fred';
import { compileOpenApi } from './openapi';
import { fetchCatalogSpec, RegistryFetchError } from './registrySearch';

const FRED = curatedApi('omni:fred')!;

describe('FRED, as OmniOS ships it', () => {
    const { manifests, errors } = compileOpenApi(FRED.spec, { sourceLocator: FRED.entry.specUrl, brokerOrigins: FRED.brokerOrigins });

    it('compiles to the three reads its entry claims, all through the server broker', () => {
        expect(errors).toEqual([]);
        expect(manifests).toHaveLength(FRED.entry.operations!);
        for (const manifest of manifests) {
            expect(manifest.effect).toBe('read');
            expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('server_broker');
            expect(manifest.transport.kind === 'http' && manifest.transport.baseUrl).toBe('https://api.stlouisfed.org/fred');
        }
    });

    it('asks for the key once, in the query where FRED reads it, with where to get one', () => {
        const slots = new Set(manifests.map(m => m.auth.secretRef));
        expect(slots.size).toBe(1);
        expect(manifests[0].auth).toMatchObject({ kind: 'apiKey', in: 'query', name: 'api_key' });
        expect(manifests[0].auth.hint).toContain('https://fredaccount.stlouisfed.org/apikeys');
    });

    it('pins the JSON format FRED would otherwise not send', () => {
        const observations = manifests.find(m => m.source.operationId === 'getSeriesObservations')!;
        expect(observations.inputs.find(i => i.name === 'file_type')).toMatchObject({ required: true, schema: { enum: ['json'] } });
        expect(observations.inputs.find(i => i.name === 'series_id')).toMatchObject({ required: true, example: 'UNRATE' });
    });
});

describe('who can choose the server broker', () => {
    it('is the host: the same spec without its curated entry compiles browser-direct', () => {
        for (const manifest of compileOpenApi(FRED_SPEC).manifests) {
            expect(manifest.transport.kind === 'http' && manifest.transport.access).toBe('browser_direct');
        }
    });

    it('never a write, even on a broker origin', () => {
        const spec = structuredClone(FRED_SPEC) as typeof FRED_SPEC & { paths: Record<string, unknown> };
        spec.paths['/notes'] = {
            post: { summary: 'Add a note', responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } } }
        };
        const write = compileOpenApi(spec, { brokerOrigins: FRED.brokerOrigins }).manifests.find(m => m.effect === 'write')!;
        expect(write.transport.kind === 'http' && write.transport.access).toBe('browser_direct');
    });
});

describe('a curated entry', () => {
    it('serves its spec from the bundle, without a fetch', async () => {
        const fetchImpl = vi.fn();
        const document = await fetchCatalogSpec(FRED.entry, { fetchImpl });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(document).toEqual(FRED_SPEC);
        expect(document).not.toBe(FRED_SPEC); // a copy: nothing downstream can change the shipped spec
    });

    it('cannot be claimed by an entry the repo does not list', async () => {
        const forged = { ...FRED.entry, id: 'omni:not-shipped' };
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
    it.each(CURATED_APIS.map(api => [api.entry.id, api] as const))('%s compiles to what its entry claims, routed as declared', (_id, api) => {
        const { manifests, errors } = compileOpenApi(api.spec, { sourceLocator: api.entry.specUrl, brokerOrigins: api.brokerOrigins });
        expect(errors).toEqual([]);
        expect(manifests).toHaveLength(api.entry.operations!);
        for (const manifest of manifests) {
            expect(manifest.effect).toBe('read');
            const access = manifest.transport.kind === 'http' ? manifest.transport.access : null;
            expect(access).toBe(api.brokerOrigins.length > 0 ? 'server_broker' : 'browser_direct');
            if (manifest.auth.kind !== 'none') expect(manifest.auth.hint?.length ?? 0, api.entry.id).toBeGreaterThan(20); // says where to get the key
        }
    });

    it('needs no key for BLS, and sends Metaculus its token the way it asks', () => {
        const bls = compileOpenApi(curatedApi('omni:bls')!.spec).manifests[0];
        expect(bls.auth.kind).toBe('none');
        const metaculus = compileOpenApi(curatedApi('omni:metaculus')!.spec).manifests[0];
        expect(metaculus.auth).toMatchObject({ kind: 'apiKey', in: 'header', name: 'Authorization', prefix: 'Token ' });
        const news = compileOpenApi(curatedApi('omni:newsapi')!.spec).manifests[0];
        expect(news.auth).toMatchObject({ kind: 'apiKey', in: 'header', name: 'X-Api-Key' }); // kept out of the URL
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
