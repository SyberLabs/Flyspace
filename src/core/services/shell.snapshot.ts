// ============================================
// PROJECT OMNI: SHELL SNAPSHOT SERVICE
// Captures complete state of the Shell for Mind analysis
// ============================================

import { useBlockStore, useMindStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { BlockInstance } from '@/core/schemas/block.schema';
import { ContextEntry } from '@/core/schemas/mind.schema';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Complete snapshot of the Shell's current state
 */
export interface ShellSnapshot {
    /** Timestamp when snapshot was taken */
    timestamp: number;

    /** Number of blocks in scope (active shell, wired or pinned) */
    totalBlocks: number;

    /** In-scope block instances with their data */
    blocks: BlockSnapshotData[];

    /** Pinned/focused blocks (high priority) */
    focusedBlocks: ContextEntry[];

    /** Active wires between in-scope blocks */
    connections: {
        sourceBlockId: string;
        targetBlockId: string;
    }[];

    /** Summary statistics */
    stats: {
        connectedBlocks: number;
        disconnectedBlocks: number;
        errorBlocks: number;
        blocksByCategory: Record<string, number>;
        dataAge: {
            newest: number | null;
            oldest: number | null;
        };
    };
}

/**
 * Snapshot data for a single block
 */
export interface BlockSnapshotData {
    /** Instance ID */
    instanceId: string;

    /** Block type */
    blockType: string;

    /** Display name */
    displayName: string;

    /** Category (truth, pulse, physicality, model) */
    category: string;

    /** Connection status */
    status: string;

    /** Position on canvas */
    position: { x: number; y: number };

    /** Dimensions */
    dimensions: { width: number; height: number };

    /** Last updated timestamp */
    lastUpdated: number | null;

    /** Whether this block is pinned */
    isPinned: boolean;

    /** Raw data payload */
    data: unknown;

    /** Human-readable summary of the data */
    summary: string;

    /** Key metrics extracted from the data */
    keyMetrics: string[];

    /** Error message if any */
    error?: string;
}

/**
 * Capture what the canvas shows the Mind: the blocks of the ACTIVE shell that
 * are wired (an active wire in or out) or explicitly pinned. Nothing else.
 *
 * The product promise is that a mind's context is what you can point at. This
 * used to snapshot every stored block in every shell, so Think could answer
 * from blocks with no wire, or from a shell that was not on screen.
 */
export function captureShellSnapshot(): ShellSnapshot {
    const blockStore = useBlockStore.getState();
    const mindStore = useMindStore.getState();

    const { contextPools, isPinned } = mindStore;
    const shellBlocks = blockStore.getBlocksByShell(blockStore.activeShellId);
    const shellBlockIds = new Set(shellBlocks.map(b => b.instance_id));

    // Single wire system: connections come from the wire store. Only active
    // wires count (a stale wire carried no data), and both ends must be on
    // this shell so a stray cross-shell wire cannot pull a foreign block in.
    const wires = useWireStore.getState().wires.filter(w =>
        w.status === 'active'
        && shellBlockIds.has(w.sourceBlockId)
        && shellBlockIds.has(w.targetBlockId)
    );
    const wiredIds = new Set(wires.flatMap(w => [w.sourceBlockId, w.targetBlockId]));
    const blocks = shellBlocks.filter(b => wiredIds.has(b.instance_id) || isPinned(b.instance_id));
    const includedIds = new Set(blocks.map(b => b.instance_id));

    // Get focused blocks (pins on blocks outside this scope stay out)
    const focusPool = contextPools.find(p => p.id === 'focus');
    const focusedBlocks = (focusPool?.entries || []).filter(
        e => e.sourceBlockId !== undefined && includedIds.has(e.sourceBlockId)
    );

    // Process each block
    const blockSnapshots: BlockSnapshotData[] = blocks.map(block => ({
        instanceId: block.instance_id,
        blockType: block.schema.block_id,
        displayName: block.schema.display_name,
        category: block.schema.category,
        status: block.status,
        position: block.position,
        dimensions: block.dimensions,
        lastUpdated: block.last_updated,
        isPinned: isPinned(block.instance_id),
        data: block.data,
        summary: summarizeBlockData(block),
        keyMetrics: extractKeyMetrics(block),
        error: block.error
    }));

    // Calculate stats
    const stats = calculateShellStats(blocks);

    return {
        timestamp: Date.now(),
        totalBlocks: blocks.length,
        blocks: blockSnapshots,
        focusedBlocks,
        connections: wires.map(w => ({
            sourceBlockId: w.sourceBlockId,
            targetBlockId: w.targetBlockId
        })),
        stats
    };
}

/**
 * Summarize a block's data in human-readable format
 */
function summarizeBlockData(block: BlockInstance): string {
    const blockType = block.schema.block_id;
    const data = block.data;

    if (!data) {
        return `No data loaded`;
    }

    switch (blockType) {
        case 'polymarket': {
            const markets = data as Array<{
                question: string;
                outcomes: Array<{ name: string; probability: number }>;
                volume?: number;
            }>;
            if (!markets || !markets.length) return 'No markets loaded';

            const market = markets[0];
            const topOutcome = market.outcomes?.[0];
            return `"${market.question}" - ${topOutcome?.name}: ${(topOutcome?.probability * 100).toFixed(1)}%${market.volume ? ` | Vol: $${(market.volume / 1000).toFixed(0)}k` : ''}`;
        }

        case 'newsapi': {
            const articles = data as Array<{
                title: string;
                source: { name: string };
                sentiment?: string;
            }>;
            if (!articles || !articles.length) return 'No articles loaded';

            const sentiments = articles.map(a => a.sentiment).filter(Boolean);
            const sentimentCounts = sentiments.reduce((acc, s) => {
                acc[s!] = (acc[s!] || 0) + 1;
                return acc;
            }, {} as Record<string, number>);

            return `${articles.length} articles | Latest: "${articles[0]?.title.slice(0, 60)}..." (${articles[0]?.source?.name})${Object.keys(sentimentCounts).length ? ` | Sentiment: ${Object.entries(sentimentCounts).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}`;
        }

        case 'tradingview': {
            const d = isRecord(data) ? data : {};
            if (typeof d.symbol === 'string') {
                const interval = typeof d.interval === 'string' ? d.interval : '1D';
                const price = d.price != null ? ` | Price: $${d.price}` : '';
                return `Chart: ${d.symbol} - ${interval} timeframe${price}`;
            }
            return 'No symbol configured';
        }

        case 'gdelt': {
            const events = isRecord(data) && Array.isArray(data.events) ? data.events : [];
            if (!events.length) return 'No events loaded';

            const categories = [...new Set(events.slice(0, 10).map((e) =>
                isRecord(e) && typeof e.category === 'string' ? e.category : undefined
            ).filter((c): c is string => !!c))];
            return `${events.length} global events | Categories: ${categories.slice(0, 3).join(', ')}${categories.length > 3 ? '...' : ''}`;
        }

        case 'persona_analyst':
        case 'persona_strategist':
        case 'persona_oracle':
        case 'persona_guardian': {
            const messages = isRecord(data) && Array.isArray(data.messages) ? data.messages : [];
            if (!messages.length) return 'No conversation yet';
            return `${messages.length} messages in conversation`;
        }

        default: {
            // Generic handling
            if (Array.isArray(data)) {
                return `${data.length} items loaded`;
            } else if (typeof data === 'object' && data !== null) {
                const keys = Object.keys(data);
                return `${keys.length} data fields: ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '...' : ''}`;
            }
            return 'Data loaded';
        }
    }
}

/**
 * Extract key metrics from block data
 */
function extractKeyMetrics(block: BlockInstance): string[] {
    const metrics: string[] = [];
    const blockType = block.schema.block_id;
    const data = block.data;

    if (!data) return metrics;

    switch (blockType) {
        case 'polymarket': {
            const markets = data as Array<{
                outcomes: Array<{ name: string; probability: number }>;
                volume?: number;
            }>;
            if (markets && markets.length > 0) {
                const market = markets[0];
                const topOutcome = market.outcomes?.[0];
                if (topOutcome) {
                    metrics.push(`${topOutcome.name}: ${(topOutcome.probability * 100).toFixed(1)}%`);
                }
                if (market.volume) {
                    metrics.push(`Vol: $${(market.volume / 1000).toFixed(0)}k`);
                }
            }
            break;
        }

        case 'newsapi': {
            const articles = data as Array<{ sentiment?: string }>;
            if (articles && articles.length > 0) {
                metrics.push(`${articles.length} articles`);
                const sentiments = articles.map(a => a.sentiment).filter(Boolean);
                if (sentiments.length > 0) {
                    const positive = sentiments.filter(s => s === 'positive').length;
                    const negative = sentiments.filter(s => s === 'negative').length;
                    metrics.push(`+${positive}/-${negative}`);
                }
            }
            break;
        }

        case 'tradingview': {
            const d = isRecord(data) ? data : {};
            if (typeof d.price === 'number') metrics.push(`$${d.price}`);
            if (typeof d.change === 'number') metrics.push(`${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}%`);
            break;
        }
    }

    return metrics;
}

/**
 * Calculate statistics about the Shell state
 */
function calculateShellStats(blocks: BlockInstance[]) {
    const stats = {
        connectedBlocks: 0,
        disconnectedBlocks: 0,
        errorBlocks: 0,
        blocksByCategory: {} as Record<string, number>,
        dataAge: {
            newest: null as number | null,
            oldest: null as number | null
        }
    };

    for (const block of blocks) {
        // Count by status
        if (block.status === 'connected') stats.connectedBlocks++;
        else if (block.status === 'disconnected') stats.disconnectedBlocks++;
        else if (block.status === 'error') stats.errorBlocks++;

        // Count by category
        const cat = block.schema.category;
        stats.blocksByCategory[cat] = (stats.blocksByCategory[cat] || 0) + 1;

        // Track data age
        if (block.last_updated) {
            if (!stats.dataAge.newest || block.last_updated > stats.dataAge.newest) {
                stats.dataAge.newest = block.last_updated;
            }
            if (!stats.dataAge.oldest || block.last_updated < stats.dataAge.oldest) {
                stats.dataAge.oldest = block.last_updated;
            }
        }
    }

    return stats;
}

/**
 * Format snapshot into LLM-friendly context string
 */
export function formatSnapshotForLLM(snapshot: ShellSnapshot): string {
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push('SHELL LANDSCAPE SNAPSHOT');
    lines.push(`Captured at: ${new Date(snapshot.timestamp).toLocaleString()}`);
    lines.push('='.repeat(60));
    lines.push('');

    // Overview
    lines.push('## OVERVIEW');
    lines.push(`Blocks in scope: ${snapshot.totalBlocks}`);
    lines.push(`Connected: ${snapshot.stats.connectedBlocks} | Disconnected: ${snapshot.stats.disconnectedBlocks} | Errors: ${snapshot.stats.errorBlocks}`);
    lines.push(`Categories: ${Object.entries(snapshot.stats.blocksByCategory).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    if (snapshot.stats.dataAge.newest) {
        const age = Date.now() - snapshot.stats.dataAge.newest;
        lines.push(`Data Freshness: ${Math.floor(age / 1000)}s ago`);
    }
    lines.push('');

    // Focused blocks (highest priority)
    if (snapshot.focusedBlocks.length > 0) {
        lines.push('## FOCUSED BLOCKS (📌 Pinned for Deep Analysis)');
        lines.push('');
        for (const entry of snapshot.focusedBlocks) {
            lines.push(entry.content);
            lines.push('');
        }
        lines.push('-'.repeat(60));
        lines.push('');
    }

    // All blocks
    lines.push('## WIRED OR PINNED BLOCKS IN THIS SHELL');
    lines.push('');

    // Group blocks by category
    const blocksByCategory: Record<string, BlockSnapshotData[]> = {};
    for (const block of snapshot.blocks) {
        if (!blocksByCategory[block.category]) {
            blocksByCategory[block.category] = [];
        }
        blocksByCategory[block.category].push(block);
    }

    for (const [category, categoryBlocks] of Object.entries(blocksByCategory)) {
        lines.push(`### ${category.toUpperCase()} (${categoryBlocks.length})`);
        lines.push('');

        for (const block of categoryBlocks) {
            const pinIcon = block.isPinned ? '📌 ' : '';
            const statusIcon = block.status === 'connected' ? '🟢' : block.status === 'error' ? '🔴' : '⚪';

            lines.push(`${pinIcon}${statusIcon} **${block.displayName}** (${block.blockType})`);
            lines.push(`   Summary: ${block.summary}`);

            if (block.keyMetrics.length > 0) {
                lines.push(`   Metrics: ${block.keyMetrics.join(' | ')}`);
            }

            if (block.error) {
                lines.push(`   ⚠️ Error: ${block.error}`);
            }

            if (block.lastUpdated) {
                const age = Date.now() - block.lastUpdated;
                lines.push(`   Last updated: ${Math.floor(age / 1000)}s ago`);
            }

            lines.push('');
        }
    }

    lines.push('='.repeat(60));

    return lines.join('\n');
}
