// ============================================
// PROJECT OMNI: WORLD BANK BLOCK ADAPTER
// Uses the centralized API Gateway for indicators
// ============================================

import { useEffect } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import type { OmniItem, OmniMetrics } from '@/core/gateway';

export interface WorldBankBlockData {
    items: OmniItem[];
    metrics: OmniMetrics | null;
}

export interface WorldBankBlockParams {
    indicator?: string;
    country?: string;
    per_page?: number;
    startYear?: string | number;
    endYear?: string | number;
    [key: string]: unknown; // satisfies Record<string, unknown> for useOmniData params
}

export function useWorldBankBlock(instanceId: string, params?: WorldBankBlockParams) {
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
    } = useOmniData('worldbank', instanceId, {
        immediate: true,
        params,
        refreshInterval: useMockData ? 30000 : 60 * 60 * 1000
    });

    const metrics = data?.metrics || null;

    useEffect(() => {
        if (items.length > 0 || metrics) {
            const payload: WorldBankBlockData = { items, metrics };
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

    const cachedData = (block?.data as WorldBankBlockData | undefined) || null;

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
