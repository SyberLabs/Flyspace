'use client';

// ============================================
// PROJECT OMNI: OPENALEX WORKS VIEW
// ============================================

import { motion } from 'framer-motion';
import { BookOpen, ExternalLink, RefreshCw, Clock } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { OmniItem } from '@/core/gateway';
import { BlockBodyState } from './BlockSetupCard';

interface OpenAlexViewProps {
    items: OmniItem[];
    status: string;
    lastUpdated: number | null;
    searchInput: string;
    topicInput: string;
    yearInput: string;
    onSearchInputChange: (value: string) => void;
    onTopicInputChange: (value: string) => void;
    onYearInputChange: (value: string) => void;
    onApplyFilters: () => void;
    onRefresh?: () => void;
    error?: string | null;
}

export function OpenAlexView({
    items,
    status,
    lastUpdated,
    searchInput,
    topicInput,
    yearInput,
    onSearchInputChange,
    onTopicInputChange,
    onYearInputChange,
    onApplyFilters,
    onRefresh,
    error
}: OpenAlexViewProps) {
    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-[var(--citadel-border)]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={cn(
                            "w-2 h-2 rounded-full",
                            status === 'connected' ? "bg-[var(--truth-green)]" :
                                status === 'connecting' ? "bg-[var(--truth-amber)] animate-pulse" :
                                    status === 'error' ? "bg-[var(--truth-red)]" :
                                        "bg-[var(--text-muted)]"
                        )} />
                        <span className="text-xs text-[var(--text-muted)]">
                            {items.length} works
                        </span>
                    </div>
                    <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={searchInput}
                        onChange={(e) => onSearchInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onApplyFilters();
                            }
                        }}
                        placeholder="Search (keywords)"
                        className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <input
                        type="text"
                        value={topicInput}
                        onChange={(e) => onTopicInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onApplyFilters();
                            }
                        }}
                        placeholder="Topic (Txxxx or keyword)"
                        className="flex-1 min-w-[120px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <input
                        type="text"
                        value={yearInput}
                        onChange={(e) => onYearInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onApplyFilters();
                            }
                        }}
                        placeholder="Year (YYYY)"
                        className="w-[90px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <button
                        onClick={onApplyFilters}
                        className="px-2.5 py-1.5 text-xs font-medium text-[var(--citadel-primary)] hover:bg-[var(--citadel-primary)]/10 rounded-md transition-colors"
                    >
                        Apply
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={items.length === 0}
                    loadingLabel="Loading works..."
                >
                    {items.map((item, index) => (
                        <WorkCard key={item.id} item={item} index={index} />
                    ))}
                </BlockBodyState>
            </div>

            {lastUpdated && (
                <div className="px-3 py-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--citadel-border)]">
                    Updated {new Date(lastUpdated).toLocaleString()}
                </div>
            )}
        </div>
    );
}

function WorkCard({ item, index }: { item: OmniItem; index: number }) {
    const publicationYear = item.metadata?.publicationYear as number | undefined;
    const citedBy = item.metadata?.citedBy as number | undefined;
    const venue = item.description;
    const timestamp = item.timestamp ? item.timestamp : undefined;

    return (
        <motion.a
            href={item.url || item.id}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.04 }}
            className="block p-3 border-b border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)] transition-colors group"
        >
            <div className="flex gap-3">
                <div className="w-10 h-10 rounded-md bg-[var(--citadel-border)]/60 flex items-center justify-center text-[var(--text-muted)] flex-shrink-0">
                    <BookOpen className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-[var(--text-primary)] line-clamp-2 group-hover:text-[var(--citadel-primary-glow)] transition-colors">
                        {item.title}
                    </h4>
                    <div className="flex items-center flex-wrap gap-2 mt-1.5 text-xs text-[var(--text-muted)]">
                        {venue && <span>{venue}</span>}
                        {publicationYear && <span>{publicationYear}</span>}
                        {typeof citedBy === 'number' && <span>{citedBy} cites</span>}
                        {timestamp && (
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatRelativeTime(timestamp)}
                            </span>
                        )}
                    </div>
                </div>
                <ExternalLink className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
        </motion.a>
    );
}
