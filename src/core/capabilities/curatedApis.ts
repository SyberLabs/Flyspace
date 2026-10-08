// APIs OmniOS ships a spec for, because the directory has none that works.
// Each is reviewed by hand in this repo. Search lists them beside the
// directory, marked as curated. Only an entry here can route an API through
// the server broker: that is the host's choice, never a pasted document's.

import type { ApiIndexEntry } from './apiIndex';
import { FRED_SPEC } from './curated/fred';

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
    }
];

export function curatedApi(id: string): CuratedApi | undefined {
    return CURATED_APIS.find(api => api.entry.id === id);
}
