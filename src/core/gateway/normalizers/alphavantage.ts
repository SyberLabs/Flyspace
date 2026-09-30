// ============================================
// PROJECT OMNI: ALPHA VANTAGE NORMALIZER
// Converts Alpha Vantage responses to OmniData
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    OmniMetrics,
    createOmniData,
    createOmniError
} from '../omnidata.schema';

interface AlphaVantageGlobalQuoteResponse {
    'Global Quote'?: Record<string, string>;
    'Note'?: string;
    'Error Message'?: string;
}

function parseNumber(value?: string): number {
    if (!value) return 0;
    const parsed = Number(value.replace('%', ''));
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Alpha Vantage normalizer (GLOBAL_QUOTE)
 * Docs: https://www.alphavantage.co/documentation/
 */
export const alphavantageNormalizer: ApiTypeDefinition<AlphaVantageGlobalQuoteResponse> = {
    category: 'market_data',
    displayName: 'Alpha Vantage',
    cacheTtlMs: 60 * 1000,
    rateLimitMs: 12 * 1000,

    // The key lives in process.env; /api/data adds it server-side.
    fetchFn: async (_apiKey, params) => {
        const query = new URLSearchParams({
            provider: 'alpha_vantage',
            symbol: (params?.symbol as string) || 'IBM',
            function: (params?.function as string) || 'GLOBAL_QUOTE'
        });

        try {
            const response = await fetch(`/api/data?${query.toString()}`);
            const data = await response.json();
            return data;
        } catch (error) {
            return {
                'Error Message': error instanceof Error ? error.message : 'Unknown error'
            };
        }
    },

    normalizeFn: (raw) => {
        if (raw['Error Message'] || raw['Note']) {
            return createOmniError('alpha_vantage', 'market_data', {
                code: raw['Error Message'] ? 'API_ERROR' : 'RATE_LIMIT',
                message: raw['Error Message'] || raw['Note'] || 'Alpha Vantage error',
                retryable: !raw['Error Message']
            });
        }

        const quote = raw['Global Quote'] || {};
        const symbol = quote['01. symbol'] || 'UNKNOWN';
        const latestTradingDay = quote['07. latest trading day'];
        const timestamp = latestTradingDay ? Date.parse(latestTradingDay) : Date.now();

        const metrics: OmniMetrics = {
            values: {
                open: parseNumber(quote['02. open']),
                high: parseNumber(quote['03. high']),
                low: parseNumber(quote['04. low']),
                price: parseNumber(quote['05. price']),
                volume: parseNumber(quote['06. volume']),
                previousClose: parseNumber(quote['08. previous close']),
                change: parseNumber(quote['09. change']),
                changePercent: parseNumber(quote['10. change percent'])
            },
            timestamp: Number.isNaN(timestamp) ? Date.now() : timestamp
        };

        const items: OmniItem[] = [
            {
                id: `alpha-${symbol}-${metrics.timestamp}`,
                title: `${symbol} Quote`,
                description: `Price: $${metrics.values.price}`,
                timestamp: metrics.timestamp,
                tags: ['market', 'quote'],
                metadata: {
                    symbol,
                    raw: quote
                }
            }
        ];

        return createOmniData('alpha_vantage', 'market_data', { items, metrics }, 60 * 1000);
    }
};
