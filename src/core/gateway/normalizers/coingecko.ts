// ============================================
// PROJECT OMNI: COINGECKO NORMALIZER
// Converts CoinGecko API responses to OmniData
// Public API - no auth required
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    createOmniData,
    createOmniError
} from '../omnidata.schema';
import { debug } from '../../debug';

/**
 * CoinGecko coin data from /coins/markets endpoint
 * Docs: https://docs.coingecko.com/v3.0.1/reference/coins-markets
 */
interface CoinGeckoCoin {
    id: string;
    symbol: string;
    name: string;
    image: string;
    current_price: number;
    market_cap: number;
    market_cap_rank: number;
    fully_diluted_valuation?: number;
    total_volume: number;
    high_24h: number;
    low_24h: number;
    price_change_24h: number;
    price_change_percentage_24h: number;
    market_cap_change_24h: number;
    market_cap_change_percentage_24h: number;
    circulating_supply: number;
    total_supply?: number;
    max_supply?: number;
    ath: number;
    ath_change_percentage: number;
    ath_date: string;
    atl: number;
    atl_change_percentage: number;
    atl_date: string;
    last_updated: string;
    sparkline_in_7d?: {
        price: number[];
    };
}

type CoinGeckoRawResponse = CoinGeckoCoin[] | { error?: string };

/**
 * CoinGecko API normalizer
 * Uses the free public API for cryptocurrency market data
 */
export const coingeckoNormalizer: ApiTypeDefinition<CoinGeckoRawResponse> = {
    category: 'market_data',
    displayName: 'CoinGecko',
    cacheTtlMs: 60 * 1000,  // 1 minute cache (API rate limited)
    rateLimitMs: 10 * 1000, // 10 seconds between calls (conservative)

    fetchFn: async (_apiKey, params) => {
        const limit = (params?.limit as number) || 50;
        const currency = (params?.currency as string) || 'usd';

        debug('[CoinGecko] 🎯 Starting fetch...', { limit, currency });

        try {
            // CoinGecko public API - no auth needed
            // Using /coins/markets for rich market data
            const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;

            debug('[CoinGecko] 📡 Fetching from:', url);

            const response = await fetch(url, {
                headers: {
                    'Accept': 'application/json',
                }
            });

            debug('[CoinGecko] 📥 Response status:', response.status, response.statusText);

            if (!response.ok) {
                // CoinGecko returns 429 for rate limits
                if (response.status === 429) {
                    debug('[CoinGecko] ⚠️ Rate limited');
                    return { error: 'Rate limited - please wait before retrying' };
                }
                throw new Error(`CoinGecko API error: ${response.status}`);
            }

            const data = await response.json();

            debug('[CoinGecko] ✅ Data received:', {
                isArray: Array.isArray(data),
                count: Array.isArray(data) ? data.length : 0
            });

            if (Array.isArray(data) && data.length > 0) {
                debug('[CoinGecko] 🔍 First coin:', {
                    id: data[0].id,
                    name: data[0].name,
                    price: data[0].current_price,
                    change24h: data[0].price_change_percentage_24h
                });
            }

            return data;
        } catch (error) {
            debug('[CoinGecko] ⚠️ Fetch error:', error);
            return { error: error instanceof Error ? error.message : 'Unknown error' };
        }
    },

    normalizeFn: (raw) => {
        debug('[CoinGecko] 🔄 Normalizing response...');

        // Handle error response
        if (!Array.isArray(raw) && 'error' in raw && raw.error) {
            debug('[CoinGecko] ⚠️ API returned error:', raw.error);
            return createOmniError('coingecko', 'market_data', {
                code: 'API_ERROR',
                message: raw.error,
                retryable: true
            });
        }

        const coins = raw as CoinGeckoCoin[];
        debug('[CoinGecko] 📊 Processing', coins.length, 'coins');

        if (coins.length === 0) {
            debug('[CoinGecko] ⚠️ No coins received');
            return createOmniData('coingecko', 'market_data', { items: [] }, 60000);
        }

        const items: OmniItem[] = coins.map((coin) => {
            // Format price for display
            const priceFormatted = coin.current_price >= 1
                ? `$${coin.current_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `$${coin.current_price.toPrecision(4)}`;

            // Determine trend
            const changePercent = coin.price_change_percentage_24h || 0;
            const trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'neutral';

            return {
                id: coin.id,
                title: `${coin.name} (${coin.symbol.toUpperCase()})`,
                description: priceFormatted,
                url: `https://www.coingecko.com/en/coins/${coin.id}`,
                image: coin.image,
                timestamp: new Date(coin.last_updated).getTime(),
                tags: ['crypto', coin.symbol.toLowerCase()],
                metadata: {
                    symbol: coin.symbol.toUpperCase(),
                    price: coin.current_price,
                    priceFormatted,
                    marketCap: coin.market_cap,
                    marketCapRank: coin.market_cap_rank,
                    volume24h: coin.total_volume,
                    high24h: coin.high_24h,
                    low24h: coin.low_24h,
                    priceChange24h: coin.price_change_24h,
                    priceChangePercent24h: changePercent,
                    circulatingSupply: coin.circulating_supply,
                    totalSupply: coin.total_supply,
                    maxSupply: coin.max_supply,
                    ath: coin.ath,
                    athChangePercent: coin.ath_change_percentage,
                    trend
                }
            };
        });

        debug('[CoinGecko] ✅ Normalized', items.length, 'items');
        if (items.length > 0) {
            debug('[CoinGecko] 🔍 First normalized item:', {
                id: items[0].id,
                title: items[0].title,
                price: items[0].metadata?.price,
                change: items[0].metadata?.priceChangePercent24h
            });
        }

        return createOmniData('coingecko', 'market_data', { items }, 60000);
    }
};
