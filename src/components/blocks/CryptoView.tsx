'use client';

// ============================================
// PROJECT OMNI: CRYPTO MARKETS BLOCK VIEW
// ============================================

import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, RefreshCw, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockBodyState } from './BlockSetupCard';

/**
 * Crypto asset data for display
 */
export interface CryptoAsset {
    id: string;
    symbol: string;
    name: string;
    image: string;
    price: number;
    priceFormatted: string;
    marketCap: number;
    marketCapRank: number;
    volume24h: number;
    priceChange24h: number;
    priceChangePercent24h: number;
    high24h: number;
    low24h: number;
    trend: 'up' | 'down' | 'neutral';
}

interface CryptoViewProps {
    assets: CryptoAsset[];
    status: string;
    lastUpdated?: number | null;
    onRefresh?: () => void;
    error?: string | null;
}

export function CryptoView({ assets, status, onRefresh, error }: CryptoViewProps) {
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
                        {assets.length} coins
                    </span>
                </div>
                <button onClick={onRefresh} className="btn-ghost p-1.5 rounded-md">
                    <RefreshCw className="w-3.5 h-3.5" />
                </button>
            </div>

            {/* Assets List */}
            <div className="flex-1 overflow-y-auto">
                <BlockBodyState
                    error={error}
                    isLoading={status === 'connecting'}
                    isEmpty={assets.length === 0}
                    loadingLabel="Loading crypto data..."
                >
                    {assets.map((asset, index) => (
                        <CryptoAssetCard key={asset.id} asset={asset} index={index} />
                    ))}
                </BlockBodyState>
            </div>
        </div>
    );
}

interface CryptoAssetCardProps {
    asset: CryptoAsset;
    index: number;
}

function CryptoAssetCard({ asset, index }: CryptoAssetCardProps) {
    const isPositive = asset.priceChangePercent24h > 0;
    const isNegative = asset.priceChangePercent24h < 0;

    const changeColor = isPositive
        ? 'var(--truth-green)'
        : isNegative
            ? 'var(--truth-red)'
            : 'var(--text-muted)';

    const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : null;

    // Format large numbers
    const formatNumber = (num: number) => {
        if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
        return `$${num.toLocaleString()}`;
    };

    return (
        <motion.a
            href={`https://www.coingecko.com/en/coins/${asset.id}`}
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.03 }}
            className="flex items-center gap-3 p-3 border-b border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)] transition-colors group"
        >
            {/* Rank */}
            <span className="text-xs text-[var(--text-muted)] w-5">
                #{asset.marketCapRank}
            </span>

            {/* Coin Icon */}
            <div className="w-8 h-8 flex-shrink-0 rounded-full overflow-hidden bg-[var(--citadel-border)]">
                {asset.image && (
                    <img
                        src={asset.image}
                        alt={asset.symbol}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                )}
            </div>

            {/* Name & Symbol */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {asset.name}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">
                        {asset.symbol}
                    </span>
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                    MCap: {formatNumber(asset.marketCap)}
                </div>
            </div>

            {/* Price & Change */}
            <div className="text-right">
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {asset.priceFormatted}
                </div>
                <div
                    className="flex items-center justify-end gap-1 text-xs font-medium"
                    style={{ color: changeColor }}
                >
                    {TrendIcon && <TrendIcon className="w-3 h-3" />}
                    {isPositive ? '+' : ''}{asset.priceChangePercent24h?.toFixed(2)}%
                </div>
            </div>

            {/* External Link Icon */}
            <ExternalLink className="w-4 h-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </motion.a>
    );
}
