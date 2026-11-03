// APIs Flyspace ships a spec for, because the directory has none that works.
// Each is reviewed by hand in this repo. Search lists them beside the
// directory, marked as curated.

import type { ApiIndexEntry } from './apiIndex';
import type { KeyGuide } from './keyGuide';
import { ALPHA_VANTAGE_SPEC } from './curated/alphaVantage';
import { BLS_SPEC } from './curated/bls';

export interface CuratedApi {
    entry: ApiIndexEntry;
    spec: Record<string, unknown>;
    /** How to get its key, from the provider's own pages (checked 2026-10-12). */
    keyGuide?: Omit<KeyGuide, 'source'>;
    /** The environment variable the quality line reads its key from (scripts/verify-curated.ts). */
    keyEnv?: string;
}

export const CURATED_APIS: readonly CuratedApi[] = [
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
    }
];

export function curatedApi(id: string): CuratedApi | undefined {
    return CURATED_APIS.find(api => api.entry.id === id);
}
