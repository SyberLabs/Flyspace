'use client';

// ============================================
// PROJECT OMNI: POLYMARKET BLOCK VIEW
// ============================================

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, RefreshCw, Pause, Play } from 'lucide-react';
import { PolymarketMarket } from '@/core/schemas/block.schema';
import { formatProbability, formatCurrency, formatRelativeTime, cn } from '@/lib/utils';
import { BlockBodyState } from './BlockSetupCard';

interface PolymarketViewProps {
    markets: PolymarketMarket[];
    status: string;
    lastUpdated: number | null;
    onRefresh?: () => void;
    onPause?: () => void;
    onResume?: () => void;
    isPaused?: boolean;
    error?: string | null;
}

export function PolymarketView({
    markets,
    status,
    lastUpdated,
    onRefresh,
    onPause,
    onResume,
    isPaused,
    error
}: PolymarketViewProps) {
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
                        {status === 'connected' && lastUpdated
                            ? formatRelativeTime(lastUpdated)
                            : status}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    {isPaused ? (
                        <button onClick={onResume} className="btn-ghost p-1.5 rounded-md">
                            <Play className="w-3.5 h-3.5" />
                        </button>
                    ) : (
                        <button onClick={onPause} className="btn-ghost p-1.5 rounded-md">
                            <Pause className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Markets List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={markets.length === 0}
                    loadingLabel="Loading markets..."
                >
                    {markets.map((market) => (
                        <MarketCard key={market.id} market={market} />
                    ))}
                </BlockBodyState>
            </div>
        </div>
    );
}

interface MarketCardProps {
    market: PolymarketMarket;
}

function MarketCard({ market }: MarketCardProps) {
    const yesOutcome = market.outcomes.find(o => o.name === 'Yes');
    const noOutcome = market.outcomes.find(o => o.name === 'No');
    const yesProbability = yesOutcome?.probability || 0;

    // Determine trend (mock - would come from price history)
    const isUp = yesProbability > 0.5;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[var(--citadel-surface)] border border-[var(--citadel-border)] rounded-lg p-3 hover:border-[var(--citadel-primary)] transition-colors cursor-pointer"
        >
            {/* Question */}
            <p className="text-sm font-medium text-[var(--text-primary)] mb-3 line-clamp-2">
                {market.question}
            </p>

            {/* Probability Display */}
            <div className="flex items-center gap-4 mb-3">
                <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[var(--truth-green)]">YES</span>
                        <div className="flex items-center gap-1">
                            {isUp ? (
                                <TrendingUp className="w-3 h-3 text-[var(--truth-green)]" />
                            ) : (
                                <TrendingDown className="w-3 h-3 text-[var(--truth-red)]" />
                            )}
                            <span className="text-sm font-mono font-semibold text-[var(--text-primary)]">
                                {formatProbability(yesProbability)}
                            </span>
                        </div>
                    </div>
                    <div className="probability-bar">
                        <motion.div
                            className="probability-fill yes"
                            initial={{ width: 0 }}
                            animate={{ width: `${yesProbability * 100}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                        />
                    </div>
                </div>

                <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[var(--truth-red)]">NO</span>
                        <span className="text-sm font-mono font-semibold text-[var(--text-primary)]">
                            {formatProbability(noOutcome?.probability || 0)}
                        </span>
                    </div>
                    <div className="probability-bar">
                        <motion.div
                            className="probability-fill no"
                            initial={{ width: 0 }}
                            animate={{ width: `${(noOutcome?.probability || 0) * 100}%` }}
                            transition={{ duration: 0.5, ease: 'easeOut' }}
                        />
                    </div>
                </div>
            </div>

            {/* Volume & Category */}
            <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>{market.category}</span>
                <span>Vol: {formatCurrency(market.volume)}</span>
            </div>
        </motion.div>
    );
}
