// ============================================
// PROJECT OMNI: OPENALEX BLOCK ADAPTER
// Uses the centralized API Gateway for research works
// ============================================

import { useEffect } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import type { OmniItem } from '@/core/gateway';

export interface OpenAlexBlockData {
    items: OmniItem[];
}

export type OpenAlexBlockParams = Record<string, unknown>;

export function useOpenAlexBlock(instanceId: string, params?: OpenAlexBlockParams) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const { useMockData } = useSettingsStore();
    const block = getBlock(instanceId);

    const {
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData('openalex', instanceId, {
        immediate: true,
        params,
        refreshInterval: useMockData ? 30000 : 10 * 60 * 1000
    });

    useEffect(() => {
        if (items.length > 0) {
            const payload: OpenAlexBlockData = { items };
            updateData(instanceId, payload);
            updateStatus(instanceId, 'connected');
        }
    }, [items, instanceId, updateData, updateStatus]);

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

    const cachedData = (block?.data as OpenAlexBlockData | undefined) || null;

    return {
        items: cachedData?.items?.length ? cachedData.items : items,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        error
    };
}
