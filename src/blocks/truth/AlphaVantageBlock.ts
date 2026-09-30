// ============================================
// PROJECT OMNI: ALPHA VANTAGE BLOCK ADAPTER
// Uses the centralized API Gateway for market quotes
// ============================================

import { useEffect } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import type { OmniItem, OmniMetrics } from '@/core/gateway';

export interface AlphaVantageBlockData {
    items: OmniItem[];
    metrics: OmniMetrics | null;
}

export interface AlphaVantageBlockParams {
    symbol?: string;
    function?: string;
    [key: string]: unknown; // satisfies Record<string, unknown> for useOmniData params
}

export function useAlphaVantageBlock(instanceId: string, params?: AlphaVantageBlockParams) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const { useMockData } = useSettingsStore();
    const block = getBlock(instanceId);

    const {
        data,
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData('alpha_vantage', instanceId, {
        immediate: true,
        params,
        refreshInterval: useMockData ? 15000 : 60000
    });

    const metrics = data?.metrics || null;

    useEffect(() => {
        if (items.length > 0 || metrics) {
            const payload: AlphaVantageBlockData = { items, metrics };
            updateData(instanceId, payload);
            updateStatus(instanceId, 'connected');
        }
    }, [items, metrics, instanceId, updateData, updateStatus]);

    useEffect(() => {
        if (isLoading) {
            updateStatus(instanceId, 'connecting');
        }
    }, [isLoading, instanceId, updateStatus]);

    useEffect(() => {
        if (error) {
            updateStatus(instanceId, 'error', error);
        }
    }, [error, instanceId, updateStatus]);

    const cachedData = (block?.data as AlphaVantageBlockData | undefined) || null;

    return {
        items: cachedData?.items?.length ? cachedData.items : items,
        metrics: cachedData?.metrics || metrics,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        error
    };
}
