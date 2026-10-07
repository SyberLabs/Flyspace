// ============================================
// PROJECT OMNI: POLYMARKET BLOCK ADAPTER
// Now uses the centralized API Gateway
// ============================================

import { useEffect, useMemo } from 'react';
import { PolymarketMarket } from '@/core/schemas/block.schema';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import { debug } from '@/core/debug';

/**
 * Convert OmniData items to PolymarketMarket format
 * for backwards compatibility with existing views
 */
function omniItemsToMarkets(items: Array<{
    id: string;
    title: string;
    description?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
}>): PolymarketMarket[] {
    return items.map(item => ({
        id: item.id,
        question: item.title,
        description: item.description,
        outcomes: [
            {
                id: `${item.id}-yes`,
                name: 'Yes',
                probability: (item.metadata?.probability as number) || 0.5
            },
            {
                id: `${item.id}-no`,
                name: 'No',
                probability: 1 - ((item.metadata?.probability as number) || 0.5)
            }
        ],
        volume: (item.metadata?.volume as number) || 0,
        liquidity: (item.metadata?.liquidity as number) || 0,
        endDate: (item.metadata?.endDate as string) || '',
        category: (item.tags?.[0] as string) || 'General',
        tags: item.tags || ['prediction']
    }));
}

/**
 * Hook to manage Polymarket block data
 * Now uses the centralized API Gateway via useOmniData
 */
export function usePolymarketBlock(instanceId: string) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const { useMockData } = useSettingsStore();
    const block = getBlock(instanceId);

    debug('[PolymarketBlock] 🚀 Hook initialized', { instanceId, useMockData });

    // Use the new API Gateway hook
    const {
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData('polymarket', instanceId, {
        immediate: true,
        refreshInterval: useMockData ? 5000 : 60000
    });

    debug('[PolymarketBlock] 📥 useOmniData returned:', {
        itemsCount: items.length,
        isLoading,
        error,
        fromCache
    });

    // Convert OmniData items to markets and update block store
    const markets = useMemo(() => {
        const converted = omniItemsToMarkets(items);
        debug('[PolymarketBlock] 🔄 Converted to markets:', converted.length);
        return converted;
    }, [items]);

    // Sync data to block store for other components
    useEffect(() => {
        if (markets.length > 0) {
            updateData(instanceId, markets);
            updateStatus(instanceId, 'connected');
        }
    }, [markets, instanceId, updateData, updateStatus]);

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

    const cachedData = Array.isArray(block?.data) ? block.data as PolymarketMarket[] : [];

    return {
        markets: cachedData.length > 0 ? cachedData : markets,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        pause: () => { }, // Polling handled by useOmniData
        resume: refresh,
        error
    };
}
