import { beforeEach, describe, expect, it } from 'vitest';
import { curatedApi } from '@/core/capabilities/curatedApis';
import { sealManifest, type CapabilityManifest } from '@/core/capabilities/manifest';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { canonicalCapabilityId, credentialSlot } from '@/core/capabilities/identity';
import { createBrokerRateLimiter, handleCapabilityBroker, type BrokerDeps } from './capabilityBroker';
import { memoryLedger } from './capability.ledger';
import { CACHE_TTL_MS, createDataPlant } from './dataPlant';
import type { PinnedRequest } from './pinnedFetch';

const HOUSE = 'house-fred-key-0123456789abcdef';

function fredManifests(): CapabilityManifest[] {
    const fred = curatedApi('omni:fred')!;
    return compileOpenApi(fred.spec, { sourceLocator: fred.entry.specUrl, brokerOrigins: fred.brokerOrigins }).manifests;
}

/** The FRED series manifest, compiled exactly as the app compiles it. */
function fredSeries(): CapabilityManifest {
    const manifest = fredManifests().find(entry => entry.inputs.some(input => input.name === 'series_id' && input.required));
    if (!manifest) throw new Error('no FRED series operation');
    return manifest;
}

/** The same manifest aimed at another host, re-sealed so it validates as a client could send it. */
function repointed(manifest: CapabilityManifest, baseUrl: string): CapabilityManifest {
    if (manifest.transport.kind !== 'http') throw new Error('expected http');
    const transport = { ...manifest.transport, baseUrl };
    const secretRef = credentialSlot(baseUrl, manifest.auth);
    return sealManifest({ ...manifest, id: canonicalCapabilityId(transport), transport, auth: { ...manifest.auth, secretRef } });
}

const optedIn = { OMNI_HOUSE_KEYS: 'omni:fred', FRED_API_KEY: HOUSE };

describe('data plant: which manifests a house key covers', () => {
    it('covers nothing by default', () => {
        const plant = createDataPlant({ FRED_API_KEY: HOUSE });
        expect(plant.keyFor(fredSeries())).toBeNull();
        expect(plant.coverage()).toEqual({ apis: [], digests: [] });
    });

    it('covers an opted-in curated API whose key is set, by the digest the app compiles', () => {
        const plant = createDataPlant(optedIn);
        expect(plant.keyFor(fredSeries())).toEqual({ apiId: 'omni:fred', secret: HOUSE });
        const coverage = plant.coverage();
        expect(coverage.apis).toEqual(['omni:fred']);
        expect(coverage.digests).toEqual(fredManifests().map(entry => entry.digest).sort());
        expect(JSON.stringify(coverage)).not.toContain(HOUSE);
    });

    it('covers nothing when the API is opted in but the server has no key for it', () => {
        expect(createDataPlant({ OMNI_HOUSE_KEYS: 'omni:fred' }).keyFor(fredSeries())).toBeNull();
    });

    it('covers nothing in the public preview', () => {
        expect(createDataPlant({ ...optedIn, OMNI_PUBLIC_DEMO: '1' }).keyFor(fredSeries())).toBeNull();
    });

    it('does not give the key to a manifest re-pointed at another host, even with a valid digest', () => {
        const fred = fredSeries();
        const crafted = repointed(fred, 'https://collector.example.test');
        expect(crafted.digest).not.toBe(fred.digest);
        expect(createDataPlant(optedIn).keyFor(crafted)).toBeNull();
    });

    it('caps a caller and a provider per day, then resets', () => {
        const plant = createDataPlant(optedIn, undefined, { perCaller: 2, perProvider: 3 });
        expect(plant.admitCaller('a', 0)).toBe(true);
        expect(plant.admitCaller('a', 1)).toBe(true);
        expect(plant.admitCaller('a', 2)).toBe(false);
        expect(plant.admitCaller('b', 2)).toBe(true);
        expect(plant.admitCaller('a', 24 * 60 * 60_000)).toBe(true);
        expect([0, 1, 2, 3].map(now => plant.admitProvider('omni:fred', now))).toEqual([true, true, true, false]);
    });

    it('forgets a cached answer after its time to live', () => {
        const plant = createDataPlant(optedIn);
        plant.store('k', { v: 1 }, 1000);
        expect(plant.cached('k', 1000 + CACHE_TTL_MS - 1)).toEqual({ value: { v: 1 }, fetchedAt: 1000 });
        expect(plant.cached('k', 1000 + CACHE_TTL_MS)).toBeNull();
    });
});

describe('broker with a data plant', () => {
    let seen: PinnedRequest[];
    let deps: BrokerDeps;
    const body = (idempotencyKey: string, extra: Record<string, unknown> = {}) => ({
        manifest: fredSeries(),
        input: { file_type: 'json', series_id: 'UNRATE' },
        idempotencyKey,
        ...extra
    });

    beforeEach(() => {
        seen = [];
        deps = {
            ledger: memoryLedger(),
            limiter: createBrokerRateLimiter(),
            resolve: async () => ['1.1.1.1'],
            fetch: async (request) => {
                seen.push(request);
                return { status: 200, headers: { 'content-type': 'application/json' }, text: '{"observations":[{"value":"4.1"}]}' };
            },
            now: () => 5000,
            plant: createDataPlant(optedIn)
        };
    });

    it('attaches the house key when the person sent none, and says so', async () => {
        const result = await handleCapabilityBroker(body('plant-key-1'), deps);
        expect(result.status).toBe(200);
        expect(seen[0].url.searchParams.get('api_key')).toBe(HOUSE);
        expect(seen[0].url.hostname).toBe('api.stlouisfed.org');
        expect((result.body as { served?: unknown }).served).toEqual({ key: 'house', cached: false, fetchedAt: new Date(5000).toISOString() });
        expect(JSON.stringify(result.body)).not.toContain(HOUSE);
    });

    it('answers the same request from the shared cache without calling the provider again', async () => {
        await handleCapabilityBroker(body('plant-key-2'), deps);
        const again = await handleCapabilityBroker(body('plant-key-3'), { ...deps, caller: 'someone-else' });
        expect(seen).toHaveLength(1);
        expect(again.status).toBe(200);
        expect((again.body as { value: unknown }).value).toEqual({ observations: [{ value: '4.1' }] });
        expect((again.body as { served?: { cached: boolean } }).served?.cached).toBe(true);
    });

    it('uses the person\'s own key when they sent one, and never caches it', async () => {
        const own = await handleCapabilityBroker(body('plant-key-4', { secret: 'my-own-key' }), deps);
        expect(seen[0].url.searchParams.get('api_key')).toBe('my-own-key');
        expect((own.body as { served?: unknown }).served).toBeUndefined();
        await handleCapabilityBroker(body('plant-key-5'), deps);
        expect(seen).toHaveLength(2);
        expect(seen[1].url.searchParams.get('api_key')).toBe(HOUSE);
    });

    it('sends no house key to a manifest re-pointed at another host', async () => {
        const fred = fredSeries();
        const crafted = repointed(fred, 'https://collector.example.test');
        const sent = await handleCapabilityBroker({ ...body('plant-key-6'), manifest: crafted }, deps);
        expect((sent.body as { served?: unknown }).served).toBeUndefined();
        expect(seen[0].url.hostname).toBe('collector.example.test');
        expect(seen[0].url.searchParams.has('api_key')).toBe(false);
    });

    it('refuses with HOUSE_KEY_LIMIT once the caller has used today\'s share', async () => {
        deps.plant = createDataPlant(optedIn, undefined, { perCaller: 1 });
        await handleCapabilityBroker(body('plant-key-7'), deps);
        const over = await handleCapabilityBroker(body('plant-key-8'), deps);
        expect(over.status).toBe(429);
        expect((over.body as { error: { code: string } }).error.code).toBe('HOUSE_KEY_LIMIT');
        expect(seen).toHaveLength(1);
    });

    it('redacts the house key from an upstream error', async () => {
        deps.fetch = async (request) => {
            seen.push(request);
            return { status: 500, headers: {}, text: '' };
        };
        const failed = await handleCapabilityBroker(body('plant-key-9'), deps);
        expect(failed.status).toBe(502);
        expect(JSON.stringify(failed.body)).not.toContain(HOUSE);
    });
});
