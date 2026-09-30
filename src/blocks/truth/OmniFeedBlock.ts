// ============================================
// GENERIC OMNI FEED BLOCK
// Any catalog provider that stores OmniItem[] can share this hook.
// Writes { items } so wire extraction treats the block as grounding.
// ============================================

import { useEffect } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import type { OmniItem } from '@/core/gateway';

export interface OmniFeedBlockData {
    items: OmniItem[];
}

export function useOmniFeedBlock(
    instanceId: string,
    apiId: string,
    params?: Record<string, unknown>
) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const { useMockData } = useSettingsStore();
    const block = getBlock(instanceId);

    const {
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData(apiId, instanceId, {
        immediate: Boolean(apiId),
        params,
        refreshInterval: useMockData ? 60_000 : 10 * 60 * 1000
    });

    useEffect(() => {
        if (items.length > 0) {
            updateData(instanceId, { items } satisfies OmniFeedBlockData);
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
    }, [error, instanceId, updateData, updateStatus]);

    const cached = (block?.data as OmniFeedBlockData | undefined)?.items;

    return {
        items: cached?.length ? cached : items,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        error
    };
}
