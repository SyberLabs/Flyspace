// APIs Flyspace ships a spec for, because the directory has none that works.
// Each is reviewed by hand in this repo. Search lists them beside the
// directory, marked as curated. Only an entry here can route an API through
// the server broker: that is the host's choice, never a pasted document's.

import type { ApiIndexEntry } from './apiIndex';
import type { KeyGuide } from './keyGuide';
import type { CapabilityManifest } from './manifest';
import { ALPHA_VANTAGE_SPEC } from './curated/alphaVantage';
import { BLS_SPEC } from './curated/bls';
import { FRED_SPEC } from './curated/fred';
import { METACULUS_SPEC } from './curated/metaculus';
import { NEWS_API_SPEC } from './curated/newsApi';

export interface CuratedApi {
    entry: ApiIndexEntry;
    spec: Record<string, unknown>;
    /** Origins reached through the server broker: the API refuses browser calls. */
    brokerOrigins: string[];
    /** How to get its key, from the provider's own pages (checked 2026-10-12). */
    keyGuide?: Omit<KeyGuide, 'source'>;
    /** The environment variable the quality line reads its key from (scripts/verify-curated.ts). */
    keyEnv?: string;
    /** What the provider's terms require an app to show its users, on every block that calls it. */
    attribution?: Attribution;
}

export interface Attribution {
    /** The provider's own wording, shown as written. */
    notice: string;
    /** The terms a person agrees to by using the block. */
    termsUrl: string;
    termsTitle: string;
}

export const CURATED_APIS: readonly CuratedApi[] = [
    {
        entry: {
            id: 'omni:fred',
            title: 'FRED Economic Data',
            description: 'Federal Reserve economic time series: GDP, unemployment, inflation, interest rates, and 800,000 more. Free key.',
            categories: ['financial'],
            specUrl: 'omni:curated/fred',
            openapiVersion: FRED_SPEC.openapi,
            supported: true,
            updated: '2026-10-07',
            operations: 3,
            credential: 'key',
            curated: true
        },
        spec: FRED_SPEC,
        keyEnv: 'FRED_API_KEY',
        keyGuide: {
            url: 'https://fredaccount.stlouisfed.org/apikeys',
            requires: 'A free FRED account (fredaccount.stlouisfed.org); the key page needs you signed in.',
            freeTier: 'Free.',
            format: { pattern: '^[a-z0-9]{32}$', describe: '32 lowercase letters and digits' },
            test: { operationId: 'getSeriesObservations', input: { series_id: 'GDP', file_type: 'json', limit: 1 } }
        },
        brokerOrigins: ['https://api.stlouisfed.org'],
        // Required by https://fred.stlouisfed.org/docs/api/terms_of_use.html (checked 2026-10-12)
        // for an application other people use: this exact notice, shown prominently, and a link to
        // the terms that using the application means agreeing to.
        attribution: {
            notice: 'This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.',
            termsUrl: 'https://fred.stlouisfed.org/docs/api/terms_of_use.html',
            termsTitle: 'FRED® API Terms of Use'
        }
    },
    {
        entry: {
            id: 'omni:bls',
            title: 'BLS Labor Statistics',
            description: 'U.S. Bureau of Labor Statistics: unemployment, payrolls, consumer prices and wages. No key needed for light use.',
            categories: ['financial'],
            specUrl: 'omni:curated/bls',
            openapiVersion: BLS_SPEC.openapi,
            supported: true,
            updated: '2026-10-07',
            operations: 1,
            credential: 'none',
            curated: true
        },
        spec: BLS_SPEC,
        // BLS sends Access-Control-Allow-Origin: *, so the browser calls it.
        brokerOrigins: []
    },
    {
        entry: {
            id: 'omni:alpha-vantage',
            title: 'Alpha Vantage Stocks',
            description: 'Stock quotes and daily or monthly price history for shares worldwide. Free key.',
            categories: ['financial'],
            specUrl: 'omni:curated/alpha-vantage',
            openapiVersion: ALPHA_VANTAGE_SPEC.openapi,
            supported: true,
            updated: '2026-10-07',
            operations: 1,
            credential: 'key',
            curated: true
        },
        spec: ALPHA_VANTAGE_SPEC,
        keyEnv: 'ALPHA_VANTAGE_API_KEY',
        keyGuide: {
            url: 'https://www.alphavantage.co/support/#api-key',
            requires: 'A short form: what describes you, your organization, and your email.',
            freeTier: '25 requests a day.',
            // Alpha Vantage answers any non-empty key with data (checked 2026-10-12): only a missing
            // key is refused. A test call shows the API answers; it cannot show a key is yours.
            test: { operationId: 'query', input: { function: 'GLOBAL_QUOTE', symbol: 'MSFT' }, provesKey: false }
        },
        // Alpha Vantage sends Access-Control-Allow-Origin: *, so the browser calls it.
        brokerOrigins: []
    },
    {
        entry: {
            id: 'omni:newsapi',
            title: 'NewsAPI Headlines',
            description: 'Top news headlines by country or category, and search across articles from thousands of sources. Free key.',
            categories: ['media'],
            specUrl: 'omni:curated/newsapi',
            openapiVersion: NEWS_API_SPEC.openapi,
            supported: true,
            updated: '2026-10-07',
            operations: 2,
            credential: 'key',
            curated: true
        },
        spec: NEWS_API_SPEC,
        keyEnv: 'NEWSAPI_KEY',
        keyGuide: {
            url: 'https://newsapi.org/register',
            requires: 'A free NewsAPI account.',
            freeTier: '100 requests a day; articles arrive 24 hours late.',
            caveat: 'NewsAPI allows its free plan for development and testing only, not in production.',
            test: { operationId: 'topHeadlines', input: { country: 'us', pageSize: 1 } }
        },
        brokerOrigins: ['https://newsapi.org']
    },
    {
        entry: {
            id: 'omni:metaculus',
            title: 'Metaculus Forecasts',
            description: 'Community forecasts and prediction questions on future events: politics, science, technology. Free token.',
            categories: ['open_data'],
            specUrl: 'omni:curated/metaculus',
            openapiVersion: METACULUS_SPEC.openapi,
            supported: true,
            updated: '2026-10-07',
            operations: 1,
            credential: 'key',
            curated: true
        },
        spec: METACULUS_SPEC,
        keyEnv: 'METACULUS_API_KEY',
        keyGuide: {
            url: 'https://www.metaculus.com',
            requires: 'A free Metaculus account; the API token is issued from your account.',
            test: { operationId: 'listPosts', input: { limit: 1 } }
        },
        brokerOrigins: ['https://www.metaculus.com']
    }
];

/**
 * The attribution a provider's terms require, for any manifest that calls it,
 * however it was installed: matched on the API's origin, not the install path.
 */
export function attributionFor(manifest: CapabilityManifest | undefined): Attribution | null {
    if (!manifest || manifest.transport.kind !== 'http') return null;
    let origin: string;
    try {
        origin = new URL(manifest.transport.baseUrl).origin;
    } catch {
        return null;
    }
    const api = CURATED_APIS.find(entry => entry.attribution && entry.brokerOrigins.includes(origin));
    return api?.attribution ?? null;
}

export function curatedApi(id: string): CuratedApi | undefined {
    return CURATED_APIS.find(api => api.entry.id === id);
}
