// ============================================
// PROJECT OMNI: POLYMARKET NORMALIZER
// Converts Polymarket API responses to OmniData
// Uses Gamma API for market discovery
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    createOmniData,
    createOmniError
} from '../omnidata.schema';
import { debug } from '../../debug';

/**
 * Raw Polymarket Gamma API market response
 * Based on: https://docs.polymarket.com/developers/gamma-markets-api/get-markets
 */
interface PolymarketGammaMarket {
    id: string;
    question: string;
    conditionId?: string;
    slug?: string;
    description?: string;
    endDate?: string;
    image?: string;
    icon?: string;
    outcomes?: string;  // JSON string: '["Yes","No"]'
    outcomePrices?: string;  // JSON string: '[0.65, 0.35]'
    volume?: string;
    volumeNum?: number;
    liquidity?: string;
    liquidityNum?: number;
    active?: boolean;
    closed?: boolean;
    category?: string;
    // CLOB-specific fields (fallback)
    condition_id?: string;
    market_slug?: string;
    end_date_iso?: string;
    tokens?: Array<{
        token_id: string;
        outcome: string;
        price?: number;
        winner?: boolean;
    }>;
    tags?: string[];
}

type PolymarketRawResponse = PolymarketGammaMarket[] | {
    data?: PolymarketGammaMarket[];
    error?: string;
    count?: number;
};

/**
 * Polymarket API normalizer
 * Tries Gamma API first, falls back to CLOB
 */
export const polymarketNormalizer: ApiTypeDefinition<PolymarketRawResponse> = {
    category: 'prediction_market',
    displayName: 'Polymarket',
    cacheTtlMs: 60 * 1000,
    rateLimitMs: 5 * 1000,

    fetchFn: async (_apiKey, params) => {
        const limit = (params?.limit as number) || 50;

        debug('[Polymarket] 🎯 Starting fetch...', { limit });

        // Use the local Next.js API route which proxies to Gamma API server-side
        // This bypasses CORS restrictions
        try {
            const proxyUrl = `/api/polymarket?limit=${limit}`;
            debug('[Polymarket] 📡 Using local proxy:', proxyUrl);

            const response = await fetch(proxyUrl);

            if (response.ok) {
                const data = await response.json();
                debug('[Polymarket] ✅ Proxy succeeded:', {
                    success: data.success,
                    marketCount: data.markets?.length || 0
                });

                if (data.success && data.markets?.length > 0) {
                    debug('[Polymarket] 🔍 First market:', {
                        id: data.markets[0].id,
                        question: data.markets[0].question?.substring(0, 50)
                    });
                    // Return in expected format
                    return data.markets;
                }
            }

            debug('[Polymarket] ⚠️ Proxy returned:', response.status);
        } catch (proxyError) {
            debug('[Polymarket] ⚠️ Proxy failed:', proxyError);
        }

        // Fallback to direct CLOB API (may have stale data)
        try {
            const clobUrl = `https://clob.polymarket.com/markets?limit=${limit}&closed=false`;
            debug('[Polymarket] 📡 Trying CLOB API fallback:', clobUrl);

            const response = await fetch(clobUrl);

            if (response.ok) {
                const data = await response.json();
                debug('[Polymarket] ✅ CLOB API succeeded:', data.data?.length || 0, 'markets');
                return data;
            }

            throw new Error(`CLOB API error: ${response.status}`);
        } catch (error) {
            debug('[Polymarket] ⚠️ All APIs failed:', error);
            return { error: error instanceof Error ? error.message : 'Unknown error' };
        }
    },

    normalizeFn: (raw) => {
        debug('[Polymarket] 🔄 Normalizing response...');

        // Handle error response
        if (!Array.isArray(raw) && 'error' in raw && raw.error) {
            debug('[Polymarket] ⚠️ API returned error:', raw.error);
            return createOmniError('polymarket', 'prediction_market', {
                code: 'API_ERROR',
                message: raw.error,
                retryable: true
            });
        }

        // Get markets array (Gamma returns array, CLOB returns { data: [...] })
        const markets: PolymarketGammaMarket[] = Array.isArray(raw)
            ? raw
            : (raw as { data?: PolymarketGammaMarket[] }).data || [];

        debug('[Polymarket] 📊 Processing', markets.length, 'markets');

        if (markets.length === 0) {
            debug('[Polymarket] ⚠️ No markets received');
            return createOmniData('polymarket', 'prediction_market', { items: [] }, 60000);
        }

        // Log first market structure
        debug('[Polymarket] 🔍 First market keys:', Object.keys(markets[0]));

        // Take first 50 markets
        const items: OmniItem[] = markets.slice(0, 50).map((market, index) => {
            // Parse probability from outcomePrices or tokens
            let probability = 0.5;

            // Log token structure for first market
            if (index === 0) {
                debug('[Polymarket] 🔍 First market outcomes:', JSON.stringify(market.outcomes)?.substring(0, 300));
                debug('[Polymarket] 🔍 First market tokens:', market.tokens ? JSON.stringify(market.tokens).substring(0, 300) : 'undefined');
            }

            // Proxy API returns already processed outcomes with probability
            if (market.outcomes && Array.isArray(market.outcomes) && market.outcomes[0]?.probability !== undefined) {
                // Ensure probability is a number
                const rawProb = market.outcomes[0].probability;
                probability = typeof rawProb === 'string' ? parseFloat(rawProb) : rawProb;
                if (index === 0) debug('[Polymarket] ✅ Using outcomes.probability:', probability);
            }
            // Gamma API: outcomePrices is a JSON string like "[0.65, 0.35]"
            else if (market.outcomePrices) {
                try {
                    const prices = typeof market.outcomePrices === 'string'
                        ? JSON.parse(market.outcomePrices)
                        : market.outcomePrices;
                    if (Array.isArray(prices) && prices.length > 0) {
                        probability = parseFloat(prices[0]);
                    }
                } catch {
                    debug('[Polymarket] ⚠️ Could not parse outcomePrices:', market.outcomePrices);
                }
            }
            // CLOB API: tokens array with price field
            else if (market.tokens && market.tokens.length > 0) {
                // Try to find Yes token, otherwise use first token
                const yesToken = market.tokens.find((t: { outcome?: string; price?: number | string }) =>
                    t.outcome === 'Yes' || t.outcome?.toLowerCase() === 'yes'
                ) || market.tokens[0];

                if (yesToken?.price !== undefined) {
                    // Price might be string or number
                    probability = typeof yesToken.price === 'string'
                        ? parseFloat(yesToken.price)
                        : yesToken.price;
                }
            }

            // Use whichever ID field is available
            const uniqueId = market.id || market.conditionId || market.condition_id || `polymarket-${index}`;
            const slug = market.slug || market.market_slug;
            const endDate = market.endDate || market.end_date_iso;

            return {
                id: uniqueId,
                title: market.question || 'Unknown Market',
                description: market.description,
                url: slug ? `https://polymarket.com/event/${slug}` : undefined,
                image: market.image || market.icon,
                timestamp: endDate ? new Date(endDate).getTime() : undefined,
                tags: market.tags || (market.category ? [market.category] : ['prediction', 'market']),
                metadata: {
                    probability,
                    probabilityPercent: Math.round(probability * 100),
                    volume: market.volumeNum || (market.volume ? parseFloat(market.volume) : undefined),
                    liquidity: market.liquidityNum || (market.liquidity ? parseFloat(market.liquidity) : undefined),
                    endDate,
                    active: market.active,
                    closed: market.closed
                }
            };
        });

        debug('[Polymarket] ✅ Normalized', items.length, 'items');
        if (items.length > 0) {
            debug('[Polymarket] 🔍 First normalized item:', {
                id: items[0].id.substring(0, 20) + '...',
                title: items[0].title.substring(0, 40) + '...',
                probability: items[0].metadata?.probability
            });
        }

        return createOmniData('polymarket', 'prediction_market', { items }, 60000);
    }
};
