// ============================================
// PROJECT OMNI: USE OMNI DATA HOOK
// React hook for subscribing to API Gateway data
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { apiGateway, OmniData, OmniItem } from '../gateway';
import { debug } from '../debug';

interface UseOmniDataOptions {
    /** Fetch immediately on mount */
    immediate?: boolean;

    /** Parameters for the API call */
    params?: Record<string, unknown>;

    /** Auto-refresh interval in milliseconds */
    refreshInterval?: number;
}

interface UseOmniDataResult {
    /** The normalized data */
    data: OmniData | null;

    /** Just the items array for convenience */
    items: OmniItem[];

    /** Loading state */
    isLoading: boolean;

    /** Error message if any */
    error: string | null;

    /** Manually refresh */
    refresh: () => Promise<void>;

    /** Whether data is from cache */
    fromCache: boolean;
}

/**
 * Hook for consuming data from the API Gateway
 * 
 * @param apiId - The API to subscribe to
 * @param blockId - The block using this hook (for subscription tracking)
 * @param options - Configuration options
 */
export function useOmniData(
    apiId: string,
    blockId: string,
    options: UseOmniDataOptions = {}
): UseOmniDataResult {
    const { immediate = true, params, refreshInterval } = options;

    const [data, setData] = useState<OmniData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    debug('[useOmniData] 🎣 Hook called', { apiId, blockId, immediate, hasParams: !!params });

    const refresh = useCallback(async () => {
        debug('[useOmniData] 🔄 Refresh triggered for', apiId);
        setIsLoading(true);

        try {
            debug('[useOmniData] 📡 Calling apiGateway.fetch...');
            const result = await apiGateway.fetch(apiId, params);
            debug('[useOmniData] ✅ Gateway returned:', {
                hasItems: !!result.items,
                itemsCount: result.items?.length || 0,
                hasError: !!result.error,
                error: result.error?.message
            });
            setData(result);
        } catch (err) {
            console.error(`[useOmniData] ❌ Error fetching ${apiId}:`, err);
        } finally {
            setIsLoading(false);
        }
    }, [apiId, params]);

    // Subscribe to updates
    useEffect(() => {
        const unsubscribe = apiGateway.subscribe(apiId, blockId, (newData) => {
            setData(newData);
            setIsLoading(false);
        });

        // Fetch immediately if requested
        if (immediate) {
            refresh();
        }

        // Auto-refresh interval
        let intervalId: NodeJS.Timeout | null = null;
        if (refreshInterval && refreshInterval > 0) {
            intervalId = setInterval(refresh, refreshInterval);
        }

        return () => {
            unsubscribe();
            if (intervalId) clearInterval(intervalId);
        };
    }, [apiId, blockId, immediate, refresh, refreshInterval]);

    return {
        data,
        items: data?.items || [],
        isLoading,
        error: data?.error?.message || null,
        refresh,
        fromCache: data?.source?.fromCache || false
    };
}
