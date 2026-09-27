'use client';

import { ExternalLink, RefreshCw } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { OmniItem } from '@/core/gateway';
import { BlockBodyState } from './BlockSetupCard';

function stripTags(value: string): string {
    return value.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function itemHref(item: OmniItem): string | undefined {
    if (item.url) return item.url;
    const wikiTitle = item.metadata?.wikiTitle;
    if (typeof wikiTitle === 'string' && wikiTitle) {
        return `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`;
    }
    const workKey = item.metadata?.workKey;
    if (typeof workKey === 'string' && workKey.startsWith('/')) {
        return `https://openlibrary.org${workKey}`;
    }
    return undefined;
}

interface OmniFeedViewProps {
    name: string;
    items: OmniItem[];
    status: string;
    lastUpdated: number | null;
    error?: string | null;
    searchValue?: string;
    searchPlaceholder?: string;
    onSearchChange?: (value: string) => void;
    onApplySearch?: () => void;
    onRefresh?: () => void;
}

export function OmniFeedView({
    name,
    items,
    status,
    lastUpdated,
    error,
    searchValue,
    searchPlaceholder,
    onSearchChange,
    onApplySearch,
    onRefresh
}: OmniFeedViewProps) {
    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-[var(--citadel-border)]">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className={cn(
                            'w-2 h-2 rounded-full',
                            status === 'connected' ? 'bg-[var(--truth-green)]' :
                                status === 'connecting' ? 'bg-[var(--truth-amber)] animate-pulse' :
                                    status === 'error' ? 'bg-[var(--truth-red)]' :
                                        'bg-[var(--text-muted)]'
                        )} />
                        <span className="text-xs text-[var(--text-muted)]">
                            {items.length} {name}
                        </span>
                    </div>
                    <div className="flex items-center gap-1">
                        {lastUpdated ? (
                            <span className="text-xs text-[var(--text-muted)]">
                                {formatRelativeTime(lastUpdated)}
                            </span>
                        ) : null}
                        <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md" type="button">
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                {onSearchChange && onApplySearch ? (
                    <input
                        type="text"
                        value={searchValue ?? ''}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') onApplySearch();
                        }}
                        placeholder={searchPlaceholder ?? 'Search'}
                        className="mt-2 w-full px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                ) : null}
            </div>
            <div className="flex-1 overflow-y-auto">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={items.length === 0}
                    loadingLabel={`Loading ${name}...`}
                >
                    {items.map((item) => {
                        const href = itemHref(item);
                        const body = (
                            <>
                                <div className="flex items-start justify-between gap-2">
                                    <h4 className="text-sm font-medium text-[var(--text-primary)] leading-snug">
                                        {item.title}
                                    </h4>
                                    {href ? <ExternalLink className="w-3 h-3 shrink-0 text-[var(--text-muted)] mt-0.5" /> : null}
                                </div>
                                {item.description ? (
                                    <p className="mt-1 text-xs text-[var(--text-muted)] line-clamp-2">
                                        {stripTags(item.description)}
                                    </p>
                                ) : null}
                            </>
                        );
                        return href ? (
                            <a
                                key={item.id}
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-3 border-b border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)] transition-colors"
                            >
                                {body}
                            </a>
                        ) : (
                            <div
                                key={item.id}
                                className="block p-3 border-b border-[var(--citadel-border)]"
                            >
                                {body}
                            </div>
                        );
                    })}
                </BlockBodyState>
            </div>
        </div>
    );
}

export default OmniFeedView;
