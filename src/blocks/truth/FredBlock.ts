// ============================================
// PROJECT OMNI: FRED BLOCK ADAPTER
// Uses the centralized API Gateway for FRED series
// ============================================

import { useEffect } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import type { OmniItem, OmniMetrics } from '@/core/gateway';

export interface FredBlockData {
    items: OmniItem[];
    metrics: OmniMetrics | null;
}

export interface FredBlockParams {
    seriesId?: string;
    limit?: number;
    sort_order?: string;
    observationStart?: string;
    observationEnd?: string;
    [key: string]: unknown; // satisfies Record<string, unknown> for useOmniData params
}

export function useFredBlock(instanceId: string, params?: FredBlockParams) {
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
    } = useOmniData('fred', instanceId, {
        immediate: true,
        params,
        refreshInterval: useMockData ? 30000 : 15 * 60 * 1000
    });

    const metrics = data?.metrics || null;

    useEffect(() => {
        if (items.length > 0 || metrics) {
            const payload: FredBlockData = { items, metrics };
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

    const cachedData = (block?.data as FredBlockData | undefined) || null;

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
