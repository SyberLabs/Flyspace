'use client';

// ============================================
// PROJECT OMNI: ALPHA VANTAGE QUOTE VIEW
// ============================================

import { RefreshCw, TrendingUp, TrendingDown, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OmniItem, OmniMetrics } from '@/core/gateway';
import { BlockBodyState } from './BlockSetupCard';

interface AlphaVantageViewProps {
    items: OmniItem[];
    metrics: OmniMetrics | null;
    status: string;
    lastUpdated: number | null;
    symbolInput: string;
    onSymbolInputChange: (value: string) => void;
    onApplySymbol: () => void;
    onRefresh?: () => void;
    error?: string | null;
}

export function AlphaVantageView({
    items,
    metrics,
    status,
    lastUpdated,
    symbolInput,
    onSymbolInputChange,
    onApplySymbol,
    onRefresh,
    error
}: AlphaVantageViewProps) {
    const symbol = (items[0]?.metadata?.symbol as string) || 'IBM';
    const price = metrics?.values?.price ?? 0;
    const change = metrics?.values?.change ?? 0;
    const changePercent = metrics?.values?.changePercent ?? 0;

    const trend =
        change > 0 ? 'up' : change < 0 ? 'down' : 'neutral';

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
                            {symbol} quote
                        </span>
                    </div>
                    <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                    <input
                        type="text"
                        list="alpha-symbols"
                        value={symbolInput}
                        onChange={(e) => onSymbolInputChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                onApplySymbol();
                            }
                        }}
                        placeholder="Symbol (AAPL, MSFT...)"
                        className="flex-1 px-2.5 py-1.5 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-md text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                    <datalist id="alpha-symbols">
                        <option value="AAPL" />
                        <option value="MSFT" />
                        <option value="GOOGL" />
                        <option value="AMZN" />
                        <option value="NVDA" />
                        <option value="TSLA" />
                        <option value="META" />
                        <option value="IBM" />
                    </datalist>
                    <button
                        onClick={onApplySymbol}
                        className="px-2.5 py-1.5 text-xs font-medium text-[var(--citadel-primary)] hover:bg-[var(--citadel-primary)]/10 rounded-md transition-colors"
                    >
                        Apply
                    </button>
                </div>
            </div>

            <div className="flex-1 p-4 space-y-4">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={!metrics}
                    loadingLabel="Loading quote..."
                >
                    {metrics && (
                        <>
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-xs text-[var(--text-muted)]">Symbol</div>
                                    <div className="text-lg font-semibold text-[var(--text-primary)]">{symbol}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs text-[var(--text-muted)]">Price</div>
                                    <div className="text-lg font-semibold text-[var(--text-primary)]">${price.toFixed(2)}</div>
                                    <div className={cn(
                                        "text-xs flex items-center justify-end gap-1",
                                        trend === 'up' && "text-[var(--truth-green)]",
                                        trend === 'down' && "text-[var(--truth-red)]",
                                        trend === 'neutral' && "text-[var(--text-muted)]"
                                    )}>
                                        {trend === 'up' && <TrendingUp className="w-3 h-3" />}
                                        {trend === 'down' && <TrendingDown className="w-3 h-3" />}
                                        {trend === 'neutral' && <Circle className="w-2 h-2" />}
                                        {change.toFixed(2)} ({changePercent.toFixed(2)}%)
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <Metric label="Open" value={metrics.values.open} />
                                <Metric label="High" value={metrics.values.high} />
                                <Metric label="Low" value={metrics.values.low} />
                                <Metric label="Prev Close" value={metrics.values.previousClose} />
                                <Metric label="Volume" value={metrics.values.volume} format="int" />
                            </div>

                            {lastUpdated && (
                                <div className="text-[10px] text-[var(--text-muted)]">
                                    Updated {new Date(lastUpdated).toLocaleString()}
                                </div>
                            )}
                        </>
                    )}
                </BlockBodyState>
            </div>
        </div>
    );
}

function Metric({ label, value, format }: { label: string; value: number; format?: 'int' }) {
    const display = format === 'int'
        ? Math.round(value).toLocaleString()
        : value.toFixed(2);

    return (
        <div className="p-2 rounded-md bg-[var(--citadel-surface)]/60 border border-[var(--citadel-border)]">
            <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
            <div className="text-sm text-[var(--text-primary)]">{display}</div>
        </div>
    );
}
