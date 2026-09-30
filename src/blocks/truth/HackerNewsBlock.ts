// ============================================
// PROJECT OMNI: HACKER NEWS BLOCK ADAPTER
// Uses the centralized API Gateway for HN data
// ============================================

import { useEffect, useMemo } from 'react';
import { useBlockStore, useSettingsStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';
import { debug } from '@/core/debug';

/**
 * Hacker News story for block display
 */
export interface HNStory {
    id: string;
    title: string;
    url: string;
    domain: string;
    score: number;
    scoreFormatted: string;
    author: string;
    comments: number;
    hnUrl: string;
    timestamp: number;
    isAsk: boolean;
    isShow: boolean;
}

/**
 * Convert OmniData items to HNStory format
 */
function omniItemsToHNStories(items: Array<{
    id: string;
    title: string;
    url?: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
}>): HNStory[] {
    return items.map(item => ({
        id: item.id,
        title: item.title,
        url: item.url || '',
        domain: (item.metadata?.domain as string) || '',
        score: (item.metadata?.score as number) || 0,
        scoreFormatted: (item.metadata?.scoreFormatted as string) || '0 pts',
        author: (item.metadata?.author as string) || 'unknown',
        comments: (item.metadata?.comments as number) || 0,
        hnUrl: (item.metadata?.hnUrl as string) || `https://news.ycombinator.com/item?id=${item.id}`,
        timestamp: item.timestamp || Date.now(),
        isAsk: (item.metadata?.isAsk as boolean) || false,
        isShow: (item.metadata?.isShow as boolean) || false,
    }));
}

/**
 * Hook to manage Hacker News block data
 */
export function useHackerNewsBlock(instanceId: string) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const { useMockData } = useSettingsStore();
    const block = getBlock(instanceId);

    debug('[HackerNewsBlock] 🚀 Hook initialized', { instanceId, useMockData });

    const {
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData('hackernews', instanceId, {
        immediate: true,
        refreshInterval: useMockData ? 30000 : 300000  // 5 min refresh for live data
    });

    debug('[HackerNewsBlock] 📥 useOmniData returned:', {
        itemsCount: items.length,
        isLoading,
        error,
        fromCache
    });

    const stories = useMemo(() => {
        const converted = omniItemsToHNStories(items);
        debug('[HackerNewsBlock] 🔄 Converted to stories:', converted.length);
        return converted;
    }, [items]);

    useEffect(() => {
        if (stories.length > 0) {
            updateData(instanceId, stories);
            updateStatus(instanceId, 'connected');
        }
    }, [stories, instanceId, updateData, updateStatus]);

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

    const cachedData = Array.isArray(block?.data) ? block.data as HNStory[] : [];

    return {
        stories: cachedData.length > 0 ? cachedData : stories,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        error
    };
}
