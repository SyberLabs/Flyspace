// ============================================
// PROJECT OMNI: WIRE SERVICE
// Manages data flow through wire connections
// ============================================

import { useBlockStore } from '../stores';
import { useWireStore } from '../stores/wireStore';

import { WireFilters, ContextSource } from '../schemas/wire.schema';
import { PolymarketMarket, NewsArticle } from '../schemas/block.schema';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface PersonaSourceMessage {
    role: string;
    content: string;
    /** Inference-ledger row id of the turn that produced this message. */
    runId?: string;
}

function asPersonaMessages(value: unknown): PersonaSourceMessage[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter(
            (m): m is Record<string, unknown> =>
                isRecord(m) && typeof m.role === 'string' && typeof m.content === 'string'
        )
        .map(m => ({
            role: m.role as string,
            content: m.content as string,
            ...(typeof m.runId === 'string' ? { runId: m.runId } : {})
        }));
}

/**
 * The single answer a persona-as-source contributes: its last assistant
 * message, unless that message is an error.
 *
 * Shared by the formatter below and the provenance assembly in
 * `aggregateWireContext`, so the text that gets SENT and the run that gets
 * CITED can never drift apart — citing run A while sending answer B would be
 * a provenance lie, which is the one thing this layer exists to prevent.
 */
function lastPersonaAnswer(data: unknown): PersonaSourceMessage | null {
    if (!isRecord(data) || !Array.isArray(data.messages)) return null;
    const last = [...asPersonaMessages(data.messages)].reverse().find(m => m.role === 'assistant');

    // An error is not analysis. Propagating '⚠️ No LLM available' into a
    // second persona's context would compound one failure into two.
    if (!last || last.content.startsWith('⚠️')) return null;
    return last;
}

function asMemoryEntries(value: unknown): Array<{ content: string }> {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (e): e is { content: string } => isRecord(e) && typeof e.content === 'string'
    );
}

/**
 * Extract and format data from a block based on wire filters
 */
export function extractBlockData(
    blockId: string,
    filters: WireFilters
): string | null {
    const block = useBlockStore.getState().getBlock(blockId);
    if (!block?.data) return null;

    const data = block.data;
    let extracted = '';

    try {
        // Handle different data types
        if (isRecord(data) && Array.isArray(data.markets)) {
            // Polymarket data
            extracted = formatFilteredMarkets(data.markets as PolymarketMarket[], filters);
        } else if (isRecord(data) && Array.isArray(data.articles)) {
            // News data
            const articles = data.articles as NewsArticle[];
            const filtered = filters.timeWindow && filters.timeWindow !== 'all'
                ? filterArticlesByTimeWindow(articles, filters.timeWindow)
                : articles;

            if (filtered.length === 0) {
                extracted = '';
            } else if (filters.summaryOnly) {
                extracted = formatNewsSummary(filtered);
            } else {
                extracted = formatNewsDetailed(filtered);
            }
        } else if (isRecord(data) && 'personaType' in data && Array.isArray(data.messages)) {
            // A persona used as a SOURCE: another mind's conclusion, not its
            // internals. This used to fall through to the generic JSON dump,
            // which fed the downstream persona ids, timestamps and isCollapsed
            // flags — a wire that looked connected and delivered noise.
            const lastAnswer = lastPersonaAnswer(data);
            if (!lastAnswer) return null;

            extracted = filters.summaryOnly
                ? lastAnswer.content.slice(0, 500) + (lastAnswer.content.length > 500 ? '…' : '')
                : lastAnswer.content;
        } else if (isRecord(data) && 'poolId' in data && Array.isArray(data.entries)) {
            // Memory block — a Mind pool wired in like any other source.
            extracted = asMemoryEntries(data.entries)
                .filter(e => e.content.trim() !== '')
                .map(e => `- ${e.content}`)
                .join('\n');
        } else if (isRecord(data) && typeof data.content === 'string') {
            // Text block
            extracted = filters.summaryOnly
                ? data.content.slice(0, 500) + (data.content.length > 500 ? '...' : '')
                : data.content;
        } else if (isRecord(data) && Array.isArray(data.items)) {
            // OmniItem[] from the gateway (polymarket, coingecko, fred, metaculus,
            // hackernews, …). The useful signal lives in each item's `metadata`
            // (probability, volume, price, value, …) — include it, don't drop it.
            const items = data.items;
            const limit = filters.summaryOnly ? 8 : 25;
            extracted = items.slice(0, limit)
                .map(item => formatOmniItem(item))
                .join('\n');
            if (items.length > limit) extracted += `\n… ${items.length - limit} more`;
        } else if (Array.isArray(data)) {
            const first = data[0];
            if (isRecord(first) && 'question' in first && 'outcomes' in first) {
                // PolymarketMarket[] (how the Polymarket block stores its data):
                // use the dedicated formatter so outcomes + volume are included.
                extracted = formatFilteredMarkets(data as PolymarketMarket[], filters);
            } else if (isRecord(first) && 'metadata' in first) {
                // OmniItem[] stored directly.
                const limit = filters.summaryOnly ? 8 : 25;
                extracted = data.slice(0, limit).map(item => formatOmniItem(item)).join('\n');
                if (data.length > limit) extracted += `\n… ${data.length - limit} more`;
            } else {
                // Generic object array (e.g. crypto assets) — include key fields.
                extracted = data.slice(0, 20).map(item => {
                    if (typeof item === 'object') return formatOmniItem(item);
                    return `- ${item}`;
                }).join('\n');
                if (data.length > 20) extracted += `\n… ${data.length - 20} more items`;
            }
        } else {
            // Generic fallback. An object with nothing in it (`{}`, or only
            // null/blank values) would serialize to non-empty text and be
            // cited as grounding, so it extracts to nothing.
            extracted = carriesNothing(data) ? '' : JSON.stringify(data, null, 2).slice(0, 2000);
        }

        // Apply field filtering if specified
        if (filters.fields && filters.fields.length > 0) {
            // This would require more sophisticated field extraction
            // For now, we'll just include everything
        }

        // A source that carried nothing is not grounding. Return null, not a
        // placeholder like '(No data)': aggregateWireContext cites every
        // source that returns text, so a placeholder would be cited as
        // evidence. The wire's stale/empty status is UI, not provenance.
        return extracted.trim() === '' ? null : extracted;
    } catch (error) {
        console.error('Error extracting block data:', error);
        return null;
    }
}

/** True when a value holds no data: nullish, blank strings, or containers of only those. */
function carriesNothing(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.every(carriesNothing);
    if (isRecord(value)) return Object.values(value).every(carriesNothing);
    return false;
}

/**
 * Format a single OmniItem (gateway-normalized) into a readable line with its
 * key metadata, so the LLM sees probabilities/prices/values — not just titles.
 */
function formatOmniItem(item: unknown): string {
    const rec = isRecord(item) ? item : {};
    const title =
        (typeof rec.title === 'string' && rec.title)
        || (typeof rec.name === 'string' && rec.name)
        || (typeof rec.id === 'string' && rec.id)
        || (typeof rec.id === 'number' ? String(rec.id) : '')
        || 'Untitled';
    const meta = isRecord(rec.metadata) ? rec.metadata : {};

    // Keys worth surfacing, in priority order, with light formatting.
    const parts: string[] = [];
    const push = (label: string, value: unknown, fmt?: (v: unknown) => string) => {
        if (value === undefined || value === null || value === '') return;
        parts.push(`${label}: ${fmt ? fmt(value) : value}`);
    };

    push('prob', meta.probabilityPercent ?? (typeof meta.probability === 'number' ? Math.round(meta.probability * 100) : undefined), v => `${v}%`);
    push('value', meta.value);
    push('price', meta.priceFormatted ?? meta.price);
    push('24h', meta.priceChangePercent24h ?? meta.priceChangePercent, v => `${typeof v === 'number' ? v.toFixed(2) : v}%`);
    push('vol', meta.volume, v => typeof v === 'number' ? `$${Math.round(v).toLocaleString()}` : String(v));
    push('liquidity', meta.liquidity, v => typeof v === 'number' ? `$${Math.round(v).toLocaleString()}` : String(v));
    push('forecasters', meta.forecasters);
    push('marketCapRank', meta.marketCapRank, v => `#${v}`);

    // A short description adds context for news/forecast items.
    const desc = typeof rec.description === 'string' && rec.description.length < 160
        ? rec.description
        : undefined;

    const metaStr = parts.length > 0 ? ` (${parts.join(' | ')})` : '';
    const descStr = desc ? ` — ${desc}` : '';
    return `- ${title}${metaStr}${descStr}`;
}

/**
 * Apply the wire's time window and format what is left. '' when nothing is
 * left, so no formatter emits a header for zero rows.
 */
function formatFilteredMarkets(markets: PolymarketMarket[], filters: WireFilters): string {
    const filtered = filters.timeWindow && filters.timeWindow !== 'all'
        ? filterByTimeWindow(markets, filters.timeWindow)
        : markets;
    if (filtered.length === 0) return '';
    return filters.summaryOnly ? formatMarketsSummary(filtered) : formatMarketsDetailed(filtered);
}

/**
 * Filter markets by time window
 */
function filterByTimeWindow(
    markets: PolymarketMarket[],
    timeWindow: 'hour' | 'day' | 'week'
): PolymarketMarket[] {
    const now = Date.now();
    const cutoffs = {
        hour: now - 60 * 60 * 1000,
        day: now - 24 * 60 * 60 * 1000,
        week: now - 7 * 24 * 60 * 60 * 1000
    };

    const cutoff = cutoffs[timeWindow];

    return markets.filter(market => {
        const endDate = new Date(market.endDate).getTime();
        return endDate >= cutoff;
    });
}

/**
 * Filter articles by time window
 */
function filterArticlesByTimeWindow(
    articles: NewsArticle[],
    timeWindow: 'hour' | 'day' | 'week'
): NewsArticle[] {
    const now = Date.now();
    const cutoffs = {
        hour: now - 60 * 60 * 1000,
        day: now - 24 * 60 * 60 * 1000,
        week: now - 7 * 24 * 60 * 60 * 1000
    };

    const cutoff = cutoffs[timeWindow];

    return articles.filter(article => {
        const publishDate = new Date(article.publishedAt).getTime();
        return publishDate >= cutoff;
    });
}

/**
 * Format markets as summary
 */
function formatMarketsSummary(markets: PolymarketMarket[]): string {
    const lines = markets.slice(0, 5).map(market => {
        const topOutcome = market.outcomes.reduce((max, outcome) =>
            outcome.probability > max.probability ? outcome : max
        );
        return `• ${market.question.slice(0, 80)}${market.question.length > 80 ? '...' : ''}\n  → ${topOutcome.name}: ${(topOutcome.probability * 100).toFixed(1)}%`;
    });

    return `**Prediction Markets** (${markets.length} total)\n\n${lines.join('\n\n')}`;
}

/**
 * Format markets with full details
 */
function formatMarketsDetailed(markets: PolymarketMarket[]): string {
    const lines = markets.map(market => {
        const outcomes = market.outcomes
            .sort((a, b) => b.probability - a.probability)
            .map(o => `  - ${o.name}: ${(o.probability * 100).toFixed(1)}%`)
            .join('\n');

        return `**${market.question}**\n${outcomes}\nVolume: $${(market.volume / 1000).toFixed(0)}K | Ends: ${new Date(market.endDate).toLocaleDateString()}`;
    });

    return lines.join('\n\n---\n\n');
}

/**
 * Format news as summary
 */
function formatNewsSummary(articles: NewsArticle[]): string {
    const lines = articles.slice(0, 10).map(article => {
        const sentiment = article.sentiment
            ? ` [${article.sentiment === 'positive' ? '📈' : article.sentiment === 'negative' ? '📉' : '➖'}]`
            : '';
        return `• ${article.title}${sentiment}\n  ${article.source} • ${new Date(article.publishedAt).toLocaleDateString()}`;
    });

    return `**News Feed** (${articles.length} articles)\n\n${lines.join('\n\n')}`;
}

/**
 * Format news with full details
 */
function formatNewsDetailed(articles: NewsArticle[]): string {
    const lines = articles.map(article => {
        const sentiment = article.sentiment
            ? ` [Sentiment: ${article.sentiment === 'positive' ? 'Positive' : article.sentiment === 'negative' ? 'Negative' : 'Neutral'}]`
            : '';

        return `**${article.title}**${sentiment}\n${article.description || ''}\n*${article.source}* • ${new Date(article.publishedAt).toLocaleString()}\n[Read more](${article.url})`;
    });

    return lines.join('\n\n---\n\n');
}

/** What kind of evidence a source block contributes. */
function sourceKindFor(blockId: string): ContextSource['kind'] {
    if (blockId === 'memory_pool') return 'memory';
    if (blockId.startsWith('persona_')) return 'inference';
    return 'wire';
}

/**
 * Aggregate context from all wires connected to a target block
 * Optionally includes Shell Mind context based on persona settings
 */
export function aggregateWireContext(targetBlockId: string): {
    context: string;
    sourceIds: string[];
    /** Everything that fed this context, wired and ambient alike. */
    sources: ContextSource[];
    lastUpdate: number;
} {
    const wires = useWireStore.getState().getWiresToBlock(targetBlockId);
    const activeWires = wires.filter(w => w.status === 'active');

    const contextParts: string[] = [];
    const sourceIds: string[] = [];
    const sources: ContextSource[] = [];

    // Add wired block data
    if (activeWires.length === 0) {
        return {
            context: 'No active data sources connected. Wire some blocks to provide context!',
            sourceIds: [],
            sources: [],
            lastUpdate: Date.now()
        };
    }

    activeWires.forEach(wire => {
        const sourceBlock = useBlockStore.getState().getBlock(wire.sourceBlockId);
        if (!sourceBlock) return;

        const data = extractBlockData(wire.sourceBlockId, wire.filters);
        if (data) {
            contextParts.push(`## ${sourceBlock.schema.display_name}\n\n${data}`);
            sourceIds.push(wire.sourceBlockId);
            // Recollection and live data are both wired now, but they are
            // different kinds of evidence and the answer should say which.
            const kind = sourceKindFor(sourceBlock.schema.block_id);

            // One persona feeding another: cite the RUN whose answer we just
            // put in the context, not merely the block that holds it. That is
            // the edge the server walks to reconstruct a cascade's lineage.
            const parentRunId = kind === 'inference'
                ? lastPersonaAnswer(sourceBlock.data)?.runId
                : undefined;

            sources.push({
                id: wire.sourceBlockId,
                kind,
                label: sourceBlock.schema.display_name,
                ...(parentRunId ? { parentRunId } : {})
            });
        }
    });

    return {
        context: contextParts.length > 0
            ? contextParts.join('\n\n═══════════════════════════════════════\n\n')
            : 'Connected sources have no data available yet.',
        sourceIds,
        sources,
        lastUpdate: Date.now()
    };
}

/**
 * WireService class for managing wire lifecycle
 * Simplified: No polling, context updates are on-demand only
 */
class WireService {
    /**
     * Create a wire connection
     */
    createWire(sourceBlockId: string, targetBlockId: string, filters?: Partial<WireFilters>): string {
        const wireId = useWireStore.getState().addWire(sourceBlockId, targetBlockId, filters);
        if (!wireId) return '';

        // Immediate context update for target
        this.updateTargetContext(targetBlockId);

        return wireId;
    }

    /**
     * Manually update context for a target block
     */
    updateTargetContext(targetBlockId: string) {
        const block = useBlockStore.getState().getBlock(targetBlockId);
        if (!block) return;

        const { context, lastUpdate } = aggregateWireContext(targetBlockId);

        const currentData = isRecord(block.data) ? block.data : {};
        useBlockStore.getState().updateData(targetBlockId, {
            ...currentData,
            currentContext: context,
            lastContextUpdate: lastUpdate
        });
    }

    /**
     * Refresh all wires for a specific source block
     * Call this when a source block's data updates
     */
    refreshWiresFromSource(sourceBlockId: string) {
        const wires = useWireStore.getState().getWiresFromBlock(sourceBlockId);
        const targetIds = new Set(wires.map(w => w.targetBlockId));

        targetIds.forEach(targetId => {
            this.updateTargetContext(targetId);
        });
    }
}

// Singleton instance
export const wireService = new WireService();
