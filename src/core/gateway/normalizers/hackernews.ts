// ============================================
// PROJECT OMNI: HACKER NEWS NORMALIZER
// Converts HN API responses to OmniData
// Public API - no auth required
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    createOmniData,
    createOmniError
} from '../omnidata.schema';
import { debug } from '../../debug';

/**
 * Hacker News story item
 * Docs: https://github.com/HackerNews/API
 */
interface HNStory {
    id: number;
    title: string;
    url?: string;
    text?: string;  // For Ask HN, Show HN, etc.
    score: number;
    by: string;
    time: number;  // Unix timestamp
    descendants?: number;  // Comment count
    type: 'story' | 'job' | 'comment' | 'poll' | 'pollopt';
    kids?: number[];  // Comment IDs
}

type HackerNewsRawResponse = HNStory[] | { error?: string };

/**
 * Hacker News API normalizer
 * Uses the free Firebase-based API
 */
export const hackernewsNormalizer: ApiTypeDefinition<HackerNewsRawResponse> = {
    category: 'news',
    displayName: 'Hacker News',
    cacheTtlMs: 5 * 60 * 1000,  // 5 minute cache
    rateLimitMs: 5 * 1000,      // 5 seconds between calls

    fetchFn: async (_apiKey, params) => {
        const limit = (params?.limit as number) || 30;
        const storyType = (params?.type as string) || 'top';  // top, new, best, ask, show, job

        debug('[HackerNews] 🎯 Starting fetch...', { limit, storyType });

        try {
            // Step 1: Get story IDs
            const endpoint = `https://hacker-news.firebaseio.com/v0/${storyType}stories.json`;
            debug('[HackerNews] 📡 Fetching story IDs from:', endpoint);

            const idsResponse = await fetch(endpoint);
            if (!idsResponse.ok) {
                throw new Error(`HN API error: ${idsResponse.status}`);
            }

            const storyIds: number[] = await idsResponse.json();
            debug('[HackerNews] 📋 Got', storyIds.length, 'story IDs, fetching top', limit);

            // Step 2: Fetch individual stories (in parallel, limited to requested count)
            const storyPromises = storyIds.slice(0, limit).map(async (id) => {
                const storyUrl = `https://hacker-news.firebaseio.com/v0/item/${id}.json`;
                const res = await fetch(storyUrl);
                if (!res.ok) return null;
                return res.json() as Promise<HNStory>;
            });

            const stories = await Promise.all(storyPromises);
            const validStories = stories.filter((s): s is HNStory => s !== null && s.type === 'story');

            debug('[HackerNews] ✅ Fetched', validStories.length, 'stories');

            if (validStories.length > 0) {
                debug('[HackerNews] 🔍 Top story:', {
                    title: validStories[0].title?.substring(0, 50),
                    score: validStories[0].score,
                    comments: validStories[0].descendants
                });
            }

            return validStories;
        } catch (error) {
            debug('[HackerNews] ⚠️ Fetch error:', error);
            return { error: error instanceof Error ? error.message : 'Unknown error' };
        }
    },

    normalizeFn: (raw) => {
        debug('[HackerNews] 🔄 Normalizing response...');

        // Handle error response
        if (!Array.isArray(raw) && 'error' in raw && raw.error) {
            debug('[HackerNews] ⚠️ API returned error:', raw.error);
            return createOmniError('hackernews', 'news', {
                code: 'API_ERROR',
                message: raw.error,
                retryable: true
            });
        }

        const stories = raw as HNStory[];
        debug('[HackerNews] 📊 Processing', stories.length, 'stories');

        if (stories.length === 0) {
            debug('[HackerNews] ⚠️ No stories received');
            return createOmniData('hackernews', 'news', { items: [] }, 300000);
        }

        const items: OmniItem[] = stories.map((story) => {
            // Determine if it's an Ask HN, Show HN, etc.
            const isAsk = story.title?.startsWith('Ask HN:');
            const isShow = story.title?.startsWith('Show HN:');
            const isLaunch = story.title?.toLowerCase().includes('launch');

            // Format points (e.g., "142 pts")
            const scoreFormatted = `${story.score} pts`;

            // Get domain from URL if available
            let domain = '';
            if (story.url) {
                try {
                    domain = new URL(story.url).hostname.replace('www.', '');
                } catch {
                    domain = '';
                }
            }

            return {
                id: String(story.id),
                title: story.title,
                description: domain || (story.text?.substring(0, 100) + '...') || '',
                url: story.url || `https://news.ycombinator.com/item?id=${story.id}`,
                timestamp: story.time * 1000,  // Convert to milliseconds
                tags: [
                    'hackernews',
                    ...(isAsk ? ['ask'] : []),
                    ...(isShow ? ['show'] : []),
                    ...(isLaunch ? ['launch'] : [])
                ],
                metadata: {
                    score: story.score,
                    scoreFormatted,
                    author: story.by,
                    comments: story.descendants || 0,
                    hnUrl: `https://news.ycombinator.com/item?id=${story.id}`,
                    domain,
                    isAsk,
                    isShow
                }
            };
        });

        debug('[HackerNews] ✅ Normalized', items.length, 'items');

        return createOmniData('hackernews', 'news', { items }, 300000);
    }
};
