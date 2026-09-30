// ============================================
// PROJECT OMNI: NEWSAPI BLOCK ADAPTER
// Now uses the centralized API Gateway
// ============================================

import { useEffect, useMemo } from 'react';
import { NewsArticle, NewsFeed } from '@/core/schemas/block.schema';
import { useBlockStore } from '@/core/stores';
import { useOmniData } from '@/core/hooks';

/**
 * Convert OmniData items to NewsArticle format
 * for backwards compatibility with existing views
 */
function omniItemsToArticles(items: Array<{
    id: string;
    title: string;
    description?: string;
    url?: string;
    image?: string;
    timestamp?: number;
    metadata?: Record<string, unknown>;
}>): NewsArticle[] {
    return items.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description || '',
        url: item.url || '',
        imageUrl: item.image,
        publishedAt: item.timestamp
            ? new Date(item.timestamp).toISOString()
            : new Date().toISOString(),
        source: (item.metadata?.source as string) || 'Unknown',
        author: item.metadata?.author as string | undefined,
        content: item.metadata?.content as string | undefined
    }));
}

/**
 * Hook to manage NewsAPI block data
 * Now uses the centralized API Gateway via useOmniData
 */
export function useNewsBlock(instanceId: string, query?: string, category?: string) {
    const { updateData, updateStatus, getBlock } = useBlockStore();
    const block = getBlock(instanceId);

    // Use the new API Gateway hook
    const {
        items,
        isLoading,
        error,
        refresh,
        fromCache
    } = useOmniData('newsapi', instanceId, {
        immediate: true,
        refreshInterval: 5 * 60 * 1000,  // 5 minutes
        params: { query, category }
    });

    // Convert OmniData items to articles
    const articles = useMemo(() => omniItemsToArticles(items), [items]);

    // Sync data to block store for other components
    useEffect(() => {
        if (articles.length > 0) {
            const feed: NewsFeed = {
                articles,
                totalResults: articles.length,
                query,
                category
            };
            updateData(instanceId, feed);
            updateStatus(instanceId, 'connected');
        }
    }, [articles, instanceId, query, category, updateData, updateStatus]);

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

    const cachedFeed = block?.data as NewsFeed | undefined;
    const cachedArticles = cachedFeed?.articles && Array.isArray(cachedFeed.articles) ? cachedFeed.articles : [];

    return {
        feed: cachedFeed,
        articles: cachedArticles.length > 0 ? cachedArticles : articles,
        status: block?.status || (isLoading ? 'connecting' : 'connected'),
        lastUpdated: block?.last_updated,
        fromCache,
        refresh,
        error
    };
}
