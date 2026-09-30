// ============================================
// FRANKFURTER — ECB FX reference rates
// Public API, fetched via /api/public. Follows the 301 to api.frankfurter.app.
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    createOmniData,
    createOmniError
} from '../omnidata.schema';

interface FrankfurterResponse {
    amount?: number;
    base?: string;
    date?: string;
    rates?: Record<string, number>;
    error?: string | { message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const frankfurterNormalizer: ApiTypeDefinition<FrankfurterResponse> = {
    category: 'market_data',
    displayName: 'Frankfurter FX',
    cacheTtlMs: 60 * 60 * 1000,
    rateLimitMs: 2000,

    fetchFn: async (_apiKey, params) => {
        const query = new URLSearchParams({ provider: 'frankfurter' });
        if (params?.from != null) query.set('from', String(params.from));
        try {
            const response = await fetch(`/api/public?${query.toString()}`);
            return await response.json() as FrankfurterResponse;
        } catch (error) {
            return { error: error instanceof Error ? error.message : 'Unknown error' };
        }
    },

    normalizeFn: (raw) => {
        if (raw.error) {
            const message = typeof raw.error === 'string'
                ? raw.error
                : isRecord(raw.error) && typeof raw.error.message === 'string'
                    ? raw.error.message
                    : 'Frankfurter request failed';
            return createOmniError('frankfurter', 'market_data', {
                code: 'API_ERROR',
                message,
                retryable: true
            });
        }

        const base = raw.base || 'USD';
        const rates = raw.rates || {};
        const items: OmniItem[] = Object.entries(rates).map(([quote, rate]) => ({
            id: `${base}-${quote}`,
            title: `1 ${base} = ${rate} ${quote}`,
            description: raw.date ? `ECB reference ${raw.date}` : 'ECB reference rate',
            timestamp: raw.date ? Date.parse(raw.date) : undefined,
            tags: [base, quote],
            metadata: { base, quote, rate, date: raw.date }
        }));

        return createOmniData('frankfurter', 'market_data', { items }, 60 * 60 * 1000);
    }
};
