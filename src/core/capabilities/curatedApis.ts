// APIs Flyspace ships a spec for, because the directory has none that works.
// Each is reviewed by hand in this repo. Search lists them beside the
// directory, marked as curated. Only an entry here can route an API through
// the server broker: that is the host's choice, never a pasted document's.

import type { ApiIndexEntry } from './apiIndex';
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
            curated: true
        },
        spec: FRED_SPEC,
        brokerOrigins: ['https://api.stlouisfed.org']
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
            curated: true
        },
        spec: ALPHA_VANTAGE_SPEC,
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
            curated: true
        },
        spec: NEWS_API_SPEC,
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
            curated: true
        },
        spec: METACULUS_SPEC,
        brokerOrigins: ['https://www.metaculus.com']
    }
];

export function curatedApi(id: string): CuratedApi | undefined {
    return CURATED_APIS.find(api => api.entry.id === id);
}
