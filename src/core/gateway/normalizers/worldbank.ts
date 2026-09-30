// ============================================
// PROJECT OMNI: WORLD BANK NORMALIZER
// Converts World Bank indicator data to OmniData
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    OmniMetrics,
    createOmniData,
    createOmniError
} from '../omnidata.schema';

interface WorldBankSeriesItem {
    date: string;
    value: number | null;
    indicator?: { id: string; value: string };
    country?: { id: string; value: string };
}

type WorldBankResponse = [
    {
        page: number;
        pages: number;
        per_page: string;
        total: number;
    },
    WorldBankSeriesItem[]
];

function parseTimestamp(year?: string): number | undefined {
    if (!year) return undefined;
    const parsed = Date.parse(`${year}-01-01`);
    return Number.isNaN(parsed) ? undefined : parsed;
}

function buildMetrics(data: WorldBankSeriesItem[]): OmniMetrics | null {
    const numeric = data
        .filter(point => typeof point.value === 'number')
        .map(point => ({
            timestamp: parseTimestamp(point.date) ?? 0,
            value: point.value as number
        }))
        .sort((a, b) => b.timestamp - a.timestamp);

    if (numeric.length === 0) return null;

    const latest = numeric[0];
    const previous = numeric[1];
    const change = previous ? latest.value - previous.value : 0;
    const changePercent = previous && previous.value !== 0
        ? (change / previous.value) * 100
        : 0;

    return {
        values: {
            latest: latest.value,
            previous: previous?.value ?? latest.value,
            change,
            changePercent
        },
        timestamp: latest.timestamp || Date.now()
    };
}

/**
 * World Bank normalizer (indicator series)
 * Docs: https://datahelpdesk.worldbank.org/knowledgebase/topics/125589
 */
export const worldbankNormalizer: ApiTypeDefinition<WorldBankResponse | { message?: unknown }> = {
    category: 'market_data',
    displayName: 'World Bank',
    cacheTtlMs: 60 * 60 * 1000,
    rateLimitMs: 1000,

    fetchFn: async (_apiKey, params) => {
        const indicator = String(params?.indicator ?? params?.indicator_id ?? 'NY.GDP.MKTP.CD').trim();
        const country = String(params?.country ?? 'USA').trim();
        const perPage = params?.per_page ?? params?.perPage ?? 60;
        const startYear = params?.startYear ?? params?.start_year;
        const endYear = params?.endYear ?? params?.end_year;

        try {
            const url = new URL(`https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}`);
            url.searchParams.set('format', 'json');
            url.searchParams.set('per_page', String(perPage));

            if (startYear || endYear) {
                const start = startYear ? String(startYear) : '';
                const end = endYear ? String(endYear) : '';
                url.searchParams.set('date', `${start}:${end}`.replace(/^:/, '').replace(/:$/, ''));
            }

            const response = await fetch(url.toString());
            return await response.json();
        } catch (error) {
            return {
                message: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    },

    normalizeFn: (raw) => {
        if (!Array.isArray(raw) || raw.length < 2 || !Array.isArray(raw[1])) {
            return createOmniError('worldbank', 'market_data', {
                code: 'API_ERROR',
                message: 'World Bank API error or unexpected response format.',
                retryable: true
            });
        }

        const data = raw[1];
        if (!data.length) {
            return createOmniError('worldbank', 'market_data', {
                code: 'NO_DATA',
                message: 'No indicator data returned from World Bank.',
                retryable: true
            });
        }

        const items: OmniItem[] = data.map(point => {
            const timestamp = parseTimestamp(point.date);
            return {
                id: `worldbank-${point.indicator?.id ?? 'indicator'}-${point.country?.id ?? 'country'}-${point.date}`,
                title: point.date,
                description: point.value !== null ? String(point.value) : 'N/A',
                timestamp,
                tags: ['development', 'time-series'],
                metadata: {
                    value: point.value,
                    date: point.date,
                    indicatorId: point.indicator?.id,
                    indicatorName: point.indicator?.value,
                    countryId: point.country?.id,
                    countryName: point.country?.value
                }
            };
        });

        const metrics = buildMetrics(data);

        return createOmniData('worldbank', 'market_data', { items, metrics: metrics ?? undefined }, 60 * 60 * 1000);
    }
};
