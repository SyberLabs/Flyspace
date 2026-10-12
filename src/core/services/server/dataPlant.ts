// Data plant: the server's own keys for curated APIs (APEX_PLAN 6.7).
//
// The owner opts a curated API in, by id, in OMNI_HOUSE_KEYS, after reading
// that provider's terms: some free tiers allow an application key, some are
// for one developer only. Nothing is opted in by default. A house key is then
// attached by the broker to a request only when all of these hold:
//
//   - the person sent no key of their own,
//   - the manifest's digest is one this server compiled itself from a shipped
//     curated spec (so a crafted manifest cannot point the key at another
//     host: the digest covers the origin, path, and auth placement),
//   - that API is opted in and its key is set in this server's environment,
//   - the caller and the provider are both under today's cap.
//
// Answers fetched with a house key are cached for everyone for CACHE_TTL_MS,
// keyed on the manifest and the request URL, so ten people asking FRED for
// GDP cost the provider one call. A person's own key is never cached here.
// Per process: a multi-instance deployment needs a shared store for both.

import { CURATED_APIS, type CuratedApi } from '@/core/capabilities/curatedApis';
import type { CapabilityManifest } from '@/core/capabilities/manifest';
import { compileOpenApi } from '@/core/capabilities/openapi';

export const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 500;
const DAY_MS = 24 * 60 * 60_000;
/** House-key answers one caller may receive per day, cached or not. */
export const MAX_CALLER_PER_DAY = 200;
/** Upstream calls one provider may receive on a house key per day. */
export const MAX_PROVIDER_PER_DAY = 500;

export interface HouseKey {
    apiId: string;
    secret: string;
}

export interface Served {
    key: 'house';
    cached: boolean;
    fetchedAt: string;
}

export interface DataPlant {
    /** The house key for this manifest, or null when none may be used. */
    keyFor(manifest: CapabilityManifest): HouseKey | null;
    /** The digests a house key covers. Public: they are hashes of shipped specs. */
    coverage(): { apis: string[]; digests: string[] };
    /** Count one house-key request against the caller. False: over today's cap. */
    admitCaller(caller: string, now: number): boolean;
    /** Count one upstream call against the provider. False: over today's cap. */
    admitProvider(apiId: string, now: number): boolean;
    cached(key: string, now: number): { value: unknown; fetchedAt: number } | null;
    store(key: string, value: unknown, now: number): void;
}

function optedIn(env: Record<string, string | undefined>): Set<string> {
    // The public preview runs no broker; refuse here too, so a house key can
    // never be spent by a public caller even if the broker is turned back on.
    if (env.OMNI_PUBLIC_DEMO === '1') return new Set();
    return new Set((env.OMNI_HOUSE_KEYS ?? '').split(',').map(id => id.trim()).filter(Boolean));
}

/** The broker-routed manifests of one curated API, compiled the way the app compiles them. */
function compiledDigests(api: CuratedApi): string[] {
    return compileOpenApi(api.spec, { sourceLocator: api.entry.specUrl, brokerOrigins: api.brokerOrigins }).manifests
        .filter(manifest => manifest.transport.kind === 'http' && manifest.transport.access === 'server_broker')
        .filter(manifest => manifest.auth.kind !== 'none')
        .map(manifest => manifest.digest);
}

/** A per-day counter that resets at the first call after the window closes. */
function dailyCounter(limit: number) {
    const counts = new Map<string, { since: number; count: number }>();
    return (key: string, now: number): boolean => {
        const current = counts.get(key);
        const live = current && now - current.since < DAY_MS ? current : { since: now, count: 0 };
        if (live.count >= limit) return false;
        live.count += 1;
        counts.set(key, live);
        return true;
    };
}

export function createDataPlant(
    env: Record<string, string | undefined> = process.env,
    apis: readonly CuratedApi[] = CURATED_APIS,
    limits: { perCaller?: number; perProvider?: number } = {}
): DataPlant {
    const wanted = optedIn(env);
    const byDigest = new Map<string, { apiId: string; keyEnv: string }>();
    for (const api of apis) {
        if (!wanted.has(api.entry.id) || !api.keyEnv || !env[api.keyEnv]?.trim()) continue;
        for (const digest of compiledDigests(api)) byDigest.set(digest, { apiId: api.entry.id, keyEnv: api.keyEnv });
    }
    const callerCount = dailyCounter(limits.perCaller ?? MAX_CALLER_PER_DAY);
    const providerCount = dailyCounter(limits.perProvider ?? MAX_PROVIDER_PER_DAY);
    const cache = new Map<string, { value: unknown; fetchedAt: number }>();

    return {
        keyFor(manifest) {
            const covered = byDigest.get(manifest.digest);
            const secret = covered ? env[covered.keyEnv]?.trim() : undefined;
            return covered && secret ? { apiId: covered.apiId, secret } : null;
        },
        coverage() {
            const apiIds = new Set([...byDigest.values()].map(entry => entry.apiId));
            return { apis: [...apiIds].sort(), digests: [...byDigest.keys()].sort() };
        },
        admitCaller: (caller, now) => callerCount(caller, now),
        admitProvider: (apiId, now) => providerCount(apiId, now),
        cached(key, now) {
            const hit = cache.get(key);
            if (!hit) return null;
            if (now - hit.fetchedAt >= CACHE_TTL_MS) {
                cache.delete(key);
                return null;
            }
            return hit;
        },
        store(key, value, now) {
            cache.delete(key);
            cache.set(key, { value, fetchedAt: now });
            // Oldest first: a Map keeps insertion order.
            while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
        }
    };
}

let processPlant: DataPlant | null = null;

/** The plant for this process, read from its environment once. */
export function serverDataPlant(): DataPlant {
    processPlant ??= createDataPlant();
    return processPlant;
}
