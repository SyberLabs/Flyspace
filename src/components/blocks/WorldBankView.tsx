'use client';

// ============================================
// PROJECT OMNI: WORLD BANK INDICATOR VIEW
// ============================================

import { RefreshCw, TrendingUp, TrendingDown, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OmniItem, OmniMetrics } from '@/core/gateway';
import { BlockBodyState } from './BlockSetupCard';

interface WorldBankViewProps {
    items: OmniItem[];
    metrics: OmniMetrics | null;
    status: string;
    lastUpdated: number | null;
    indicatorInput: string;
    countryInput: string;
    startYearInput: string;
    endYearInput: string;
    onIndicatorInputChange: (value: string) => void;
    onCountryInputChange: (value: string) => void;
    onStartYearInputChange: (value: string) => void;
    onEndYearInputChange: (value: string) => void;
    onApplyIndicator: () => void;
    onRefresh?: () => void;
    error?: string | null;
}

export function WorldBankView({
    items,
    metrics,
    status,
    lastUpdated,
    indicatorInput,
    countryInput,
    startYearInput,
    endYearInput,
    onIndicatorInputChange,
    onCountryInputChange,
    onStartYearInputChange,
    onEndYearInputChange,
    onApplyIndicator,
    onRefresh,
    error
}: WorldBankViewProps) {
    const latest = metrics?.values?.latest ?? null;
    const change = metrics?.values?.change ?? 0;
    const changePercent = metrics?.values?.changePercent ?? 0;
    const trend = change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';

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
                            World Bank indicator
                        </span>
                    </div>
                    <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                        type="text"
                        value={indicatorInput}
                        onChange={(e) => onIndicatorInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onApplyIndicator();
                            }
                        }}
                        placeholder="Indicator (e.g., NY.GDP.MKTP.CD)"
                        className="flex-1 min-w-[160px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <input
                        type="text"
                        value={countryInput}
                        onChange={(e) => onCountryInputChange(e.target.value)}
                        placeholder="Country (USA or all)"
                        className="w-[110px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <input
                        type="text"
                        value={startYearInput}
                        onChange={(e) => onStartYearInputChange(e.target.value)}
                        placeholder="Start year"
                        className="w-[90px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <input
                        type="text"
                        value={endYearInput}
                        onChange={(e) => onEndYearInputChange(e.target.value)}
                        placeholder="End year"
                        className="w-[90px] px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <button
                        onClick={onApplyIndicator}
                        className="px-2.5 py-1.5 text-xs font-medium text-[var(--citadel-primary)] hover:bg-[var(--citadel-primary)]/10 rounded-md transition-colors"
                    >
                        Apply
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={items.length === 0 && !(metrics && latest !== null)}
                    loadingLabel="Loading observations..."
                >
                    {metrics && latest !== null && (
                        <div className="p-3 rounded-md bg-[var(--citadel-surface)]/60 border border-[var(--citadel-border)]">
                            <div className="text-[10px] text-[var(--text-muted)]">Latest</div>
                            <div className="flex items-baseline gap-2">
                                <div className="text-lg font-semibold text-[var(--text-primary)]">
                                    {formatValue(latest)}
                                </div>
                                <div className={cn(
                                    "text-xs flex items-center gap-1",
                                    trend === 'up' && "text-[var(--truth-green)]",
                                    trend === 'down' && "text-[var(--truth-red)]",
                                    trend === 'neutral' && "text-[var(--text-muted)]"
                                )}>
                                    {trend === 'up' && <TrendingUp className="w-3 h-3" />}
                                    {trend === 'down' && <TrendingDown className="w-3 h-3" />}
                                    {trend === 'neutral' && <Circle className="w-2 h-2" />}
                                    {formatValue(change)} ({changePercent.toFixed(2)}%)
                                </div>
                            </div>
                        </div>
                    )}
                    {items.length > 0 && (
                        <div className="space-y-2">
                            {items.map(item => (
                                <SeriesRow key={item.id} item={item} />
                            ))}
                        </div>
                    )}
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

function SeriesRow({ item }: { item: OmniItem }) {
    const label = item.title;
    const rawValue = item.metadata?.value ?? item.description;
    const displayValue = formatValue(rawValue);

    return (
        <div className="flex items-center justify-between text-xs px-2.5 py-2 rounded-md bg-[var(--citadel-surface)]/40 border border-[var(--citadel-border)]/60">
            <span className="text-[var(--text-muted)]">{label}</span>
            <span className="text-[var(--text-primary)] font-medium">{displayValue}</span>
        </div>
    );
}

function formatValue(value: unknown): string {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
    }
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && value !== '' && value !== null && value !== undefined) {
        return parsed.toLocaleString(undefined, { maximumFractionDigits: 4 });
    }
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
}
