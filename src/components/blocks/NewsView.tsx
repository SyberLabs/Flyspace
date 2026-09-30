'use client';

// ============================================
// PROJECT OMNI: NEWS FEED BLOCK VIEW
// ============================================

import { motion } from 'framer-motion';
import { ExternalLink, RefreshCw, Clock } from 'lucide-react';
import { NewsArticle } from '@/core/schemas/block.schema';
import { formatRelativeTime, cn } from '@/lib/utils';
import { BlockBodyState } from './BlockSetupCard';

interface NewsViewProps {
    articles: NewsArticle[];
    status: string;
    lastUpdated: number | null;
    onRefresh?: () => void;
    error?: string | null;
}

export function NewsView({ articles, status, onRefresh, error }: NewsViewProps) {
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
                    <span className="text-xs text-[var(--text-muted)]">
                        {articles.length} articles
                    </span>
                </div>
                <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Articles List */}
            <div className="flex-1 overflow-y-auto">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={articles.length === 0}
                    loadingLabel="Loading news..."
                >
                    {articles.map((article, index) => (
                        <ArticleCard key={article.id} article={article} index={index} />
                    ))}
                </BlockBodyState>
            </div>
        </div>
    );
}

interface ArticleCardProps {
    article: NewsArticle;
    index: number;
}

function ArticleCard({ article, index }: ArticleCardProps) {
    const sentimentColor =
        article.sentiment === 'positive' ? 'var(--truth-green)' :
            article.sentiment === 'negative' ? 'var(--truth-red)' :
                'var(--text-muted)';

    return (
        <motion.a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
            className="block p-3 border-b border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)] transition-colors group"
        >
            <div className="flex gap-3">
                {/* Thumbnail */}
                {article.imageUrl && (
                    <div className="w-16 h-16 flex-shrink-0 rounded-md overflow-hidden bg-[var(--citadel-border)]">
                        <img
                            src={article.imageUrl}
                            alt=""
                            className="w-full h-full object-cover"
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--citadel-primary-glow)] transition-colors">
                        {article.title}
                    </h4>

                    <div className="flex items-center gap-2 mt-1.5">
                        {/* Source */}
                        <span className="text-xs font-medium text-[var(--text-secondary)]">
                            {article.source}
                        </span>

                        {/* Separator */}
                        <span className="text-[var(--citadel-border)]">•</span>

                        {/* Time */}
                        <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatRelativeTime(new Date(article.publishedAt).getTime())}
                        </span>

                        {/* Sentiment Indicator */}
                        {article.sentiment && (
                            <>
                                <span className="text-[var(--citadel-border)]">•</span>
                                <span
                                    className="text-xs font-medium capitalize"
                                    style={{ color: sentimentColor }}
                                >
                                    {article.sentiment}
                                </span>
                            </>
                        )}
                    </div>
                </div>

                {/* External Link Icon */}
                <ExternalLink className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
        </motion.a>
    );
}
