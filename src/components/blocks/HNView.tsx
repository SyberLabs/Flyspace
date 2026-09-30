'use client';

// ============================================
// PROJECT OMNI: HACKER NEWS BLOCK VIEW
// ============================================

import { motion } from 'framer-motion';
import { Zap, MessageCircle, ArrowUp, RefreshCw, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockBodyState } from './BlockSetupCard';

/**
 * HN story data for display
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

interface HNViewProps {
    stories: HNStory[];
    status: string;
    lastUpdated?: number | null;
    onRefresh?: () => void;
    error?: string | null;
}

export function HNView({ stories, status, onRefresh, error }: HNViewProps) {
    return (
        <div className="h-full flex flex-col">
            {/* Header Controls */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--citadel-border)]">
                <div className="flex items-center gap-2">
                    <div className={cn(
                        "w-2 h-2 rounded-full",
                        status === 'connected' ? "bg-[var(--truth-green)]" :
                            status === 'connecting' ? "bg-[var(--truth-amber)] animate-pulse" :
                                status === 'error' ? "bg-[var(--truth-red)]" :
                                    "bg-[var(--text-muted)]"
                    )} />
                    <Zap className="w-3.5 h-3.5 text-[#ff6600]" />
                    <span className="text-xs text-[var(--text-muted)]">
                        {stories.length} stories
                    </span>
                </div>
                <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Stories List */}
            <div className="flex-1 overflow-y-auto">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={stories.length === 0}
                    loadingLabel="Loading Hacker News..."
                >
                    {stories.map((story, index) => (
                        <HNStoryCard key={story.id} story={story} index={index} />
                    ))}
                </BlockBodyState>
            </div>
        </div>
    );
}

interface HNStoryCardProps {
    story: HNStory;
    index: number;
}

function HNStoryCard({ story, index }: HNStoryCardProps) {
    // HN orange color for branding
    const hnOrange = '#ff6600';

    // Time ago calculation
    const timeAgo = formatTimeAgo(story.timestamp);

    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.02 }}
            className="p-3 border-b border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)] transition-colors"
        >
            {/* Title row */}
            <div className="flex items-start gap-2">
                {/* Rank number */}
                <span className="text-xs text-[var(--text-muted)] w-5 pt-0.5">
                    {index + 1}.
                </span>

                <div className="flex-1 min-w-0">
                    {/* Title + External Link */}
                    <a
                        href={story.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group"
                    >
                        <h4 className={cn(
                            "text-sm font-medium text-[var(--text-primary)] leading-snug",
                            "group-hover:text-[#ff6600] transition-colors",
                            story.isAsk && "text-[var(--truth-green)]",
                            story.isShow && "text-[var(--citadel-primary)]"
                        )}>
                            {story.title}
                            {story.domain && (
                                <span className="text-xs text-[var(--text-muted)] font-normal ml-1.5">
                                    ({story.domain})
                                </span>
                            )}
                        </h4>
                    </a>

                    {/* Meta row */}
                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-[var(--text-muted)]">
                        {/* Score */}
                        <span className="flex items-center gap-1" style={{ color: hnOrange }}>
                            <ArrowUp className="w-3 h-3" />
                            {story.score}
                        </span>

                        {/* Author */}
                        <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {story.author}
                        </span>

                        {/* Time */}
                        <span>{timeAgo}</span>

                        {/* Comments link */}
                        <a
                            href={story.hnUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 hover:text-[#ff6600] transition-colors"
                        >
                            <MessageCircle className="w-3 h-3" />
                            {story.comments} comments
                        </a>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// Simple time ago formatter
function formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(timestamp).toLocaleDateString();
}
