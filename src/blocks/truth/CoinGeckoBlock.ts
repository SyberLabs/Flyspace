// ============================================
// PROJECT OMNI: COINGECKO BLOCK ADAPTER
// Uses the centralized API Gateway for crypto data
// ============================================

import { useEffect, useMemo } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import { debug } from '@/core/debug';

/**
 * CoinGecko cryptocurrency data for block display
 */
export interface CryptoAsset {
    id: string;
    symbol: string;
    name: string;
    image: string;
    price: number;
    priceFormatted: string;
    marketCap: number;
    marketCapRank: number;
    volume24h: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    high24h: number;
    low24h: number;
    trend: 'up' | 'down' | 'neutral';
    sparkline?: number[];
}

/**
 * Convert OmniData items to CryptoAsset format
 */
function omniItemsToCryptoAssets(items: Array<{
    id: string;
    title: string;
    description?: string;
    image?: string;
    metadata?: Record<string, unknown>;
}>): CryptoAsset[] {
    return items.map(item => ({
        id: item.id,
        symbol: (item.metadata?.symbol as string) || item.id.toUpperCase(),
        name: item.title.split(' (')[0] || item.title,
        image: item.image || '',
        price: (item.metadata?.price as number) || 0,
        priceFormatted: (item.metadata?.priceFormatted as string) || item.description || '$0.00',
        marketCap: (item.metadata?.marketCap as number) || 0,
        marketCapRank: (item.metadata?.marketCapRank as number) || 0,
        volume24h: (item.metadata?.volume24h as number) || 0,
        priceChange24h: (item.metadata?.priceChange24h as number) || 0,
        priceChangePercent24h: (item.metadata?.priceChangePercent24h as number) || 0,
        high24h: (item.metadata?.high24h as number) || 0,
        low24h: (item.metadata?.low24h as number) || 0,
        trend: (item.metadata?.trend as 'up' | 'down' | 'neutral') || 'neutral',
    }));
}

/**
 * Hook to manage CoinGecko block data
 * Uses the centralized API Gateway via useOmniData
 */
export function useCoinGeckoBlock(instanceId: string) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const { useMockData } = useSettingsStore();
    const block = getBlock(instanceId);

    debug('[CoinGeckoBlock] 🚀 Hook initialized', { instanceId, useMockData });

    // Use the new API Gateway hook
    const {
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData('coingecko', instanceId, {
        immediate: true,
        refreshInterval: useMockData ? 10000 : 60000  // 1 min refresh for live data
    });

    debug('[CoinGeckoBlock] 📥 useOmniData returned:', {
        itemsCount: items.length,
        isLoading,
        error,
        fromCache
    });

    // Convert OmniData items to crypto assets
    const assets = useMemo(() => {
        const converted = omniItemsToCryptoAssets(items);
        debug('[CoinGeckoBlock] 🔄 Converted to assets:', converted.length);
        return converted;
    }, [items]);

    // Sync data to block store
    useEffect(() => {
        if (assets.length > 0) {
            updateData(instanceId, assets);
            updateStatus(instanceId, 'connected');
        }
    }, [assets, instanceId, updateData, updateStatus]);

    // Handle loading state
    useEffect(() => {
        if (isLoading) {
            updateStatus(instanceId, 'connecting');
        }
    }, [isLoading, instanceId, updateStatus]);

    // Handle errors
    useEffect(() => {
        if (error) {
            updateStatus(instanceId, 'error', error);
        }
    }, [error, instanceId, updateStatus]);

    const cachedData = Array.isArray(block?.data) ? block.data as CryptoAsset[] : [];

    return {
        assets: cachedData.length > 0 ? cachedData : assets,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        error
    };
}
