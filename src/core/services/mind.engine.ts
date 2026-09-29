// ============================================
// PROJECT OMNI: MIND ENGINE
// The reasoning core that makes the Mind think
// ============================================

import { LLMMessage } from './llm.service';
import { runTurn, runTurnStream } from '@/core/cognition';
import {
    getPersonaSystemPrompt,
    parseInsightsFromResponse,
    BlockDataSummary,
    ExtractedInsight
} from './persona.prompts';
import { captureShellSnapshot, formatSnapshotForLLM } from './shell.snapshot';
import { useMindStore } from '@/core/stores';
import { useBlockStore } from '@/core/stores';
import { PersonaConfig, type ContextEntryType } from '@/core/schemas/mind.schema';
import { BlockInstance } from '@/core/schemas/block.schema';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ============================================
// MIND ENGINE
// ============================================

const NO_SCOPE_ERROR =
    'Nothing to think about: no wired or pinned blocks in this shell. Wire a block to another block, or pin one, first.';

export class MindEngine {
    private isProcessing: boolean = false;

    /**
     * Trigger the Mind to think about current Shell data
     */
    async think(question?: string): Promise<ThinkResult> {
        if (this.isProcessing) {
            return { success: false, error: 'Already processing' };
        }

        this.isProcessing = true;
        const mindStore = useMindStore.getState();
        mindStore.setStatus('processing');

        try {
            // Get current state
            const { personas, activePersonaId } = mindStore;
            const activePersona = personas.find(p => p.id === activePersonaId);

            if (!activePersona) {
                throw new Error('No active persona');
            }

            // Snapshot of what the canvas shows: wired or pinned blocks of the
            // active shell, nothing else.
            const snapshot = captureShellSnapshot();

            if (snapshot.totalBlocks === 0) {
                mindStore.setStatus('ready');
                return { success: false, error: NO_SCOPE_ERROR };
            }

            // Build messages with rich snapshot context
            const systemPrompt = getPersonaSystemPrompt(activePersona);
            const snapshotContext = formatSnapshotForLLM(snapshot);

            // Build user prompt
            const userPrompt = this.buildSnapshotAnalysisPrompt(snapshotContext, question);

            const messages: LLMMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            // The Cognition Kernel owns the turn lifecycle (apex A4).
            const response = await runTurn(messages, { maxTokens: 1024 });
            if (!response.success) {
                mindStore.setStatus('error');
                return { success: false, error: response.error };
            }

            // Parse insights
            const insights = parseInsightsFromResponse(response.content);

            // Add insights to context pools
            // Disable auto-distribution to prevent noise - keep only raw observation
            // this.distributeInsights(insights, activePersona);

            // Add raw response to observations
            mindStore.addToPool('observations', {
                type: 'analysis',
                content: response.content,
                importance: 0.8,
                metadata: {
                    source: activePersona.name,
                    tokensUsed: response.tokensUsed,
                    blocksAnalyzed: snapshot.totalBlocks,
                    snapshotTimestamp: snapshot.timestamp
                }
            });

            mindStore.setStatus('ready');

            return {
                success: true,
                response: response.content,
                insights,
                tokensUsed: response.tokensUsed
            };

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            useMindStore.getState().setStatus('error');

            return {
                success: false,
                error: errorMessage
            };
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Stream a response for real-time display
     */
    async *thinkStream(question?: string): AsyncGenerator<string, ThinkResult> {
        if (this.isProcessing) {
            return { success: false, error: 'Already processing' };
        }

        this.isProcessing = true;
        const mindStore = useMindStore.getState();
        mindStore.setStatus('processing');

        try {
            const { personas, activePersonaId } = mindStore;
            const activePersona = personas.find(p => p.id === activePersonaId);

            if (!activePersona) {
                throw new Error('No active persona');
            }

            // Same scope as think(): wired or pinned blocks of the active shell.
            const snapshot = captureShellSnapshot();

            if (snapshot.totalBlocks === 0) {
                mindStore.setStatus('ready');
                return { success: false, error: NO_SCOPE_ERROR };
            }

            const systemPrompt = getPersonaSystemPrompt(activePersona);
            const snapshotContext = formatSnapshotForLLM(snapshot);
            const userPrompt = this.buildSnapshotAnalysisPrompt(snapshotContext, question);

            const messages: LLMMessage[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ];

            // The Cognition Kernel owns the turn lifecycle (apex A4).
            const turn = runTurnStream(messages);
            let step = await turn.next();
            let fullResponse = '';
            while (!step.done) {
                fullResponse += step.value;
                yield step.value;
                step = await turn.next();
            }
            if (!step.value.success) {
                mindStore.setStatus('error');
                return { success: false, error: step.value.error };
            }

            const insights = parseInsightsFromResponse(fullResponse);
            // Disable auto-distribution to prevent noise - keep only raw observation
            // this.distributeInsights(insights, activePersona);

            // Manually save the streamed response to observations
            mindStore.addToPool('observations', {
                type: 'analysis',
                content: fullResponse,
                importance: 0.8,
                metadata: {
                    source: activePersona.name,
                    tokensUsed: 0, // Stream doesn't report tokens yet
                    blocksAnalyzed: snapshot.totalBlocks,
                    snapshotTimestamp: snapshot.timestamp
                }
            });

            mindStore.setStatus('ready');

            return {
                success: true,
                response: fullResponse,
                insights
            };

        } catch (error) {
            useMindStore.getState().setStatus('error');
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Summarize a block of context into a single concise insight
     */
    async summarizeContext(context: string): Promise<string> {
        const prompt = `
You are a highly efficient memory crystallization engine.
Target: Distill the following data into a SINGLE, dense, high-value sentence for long-term storage.
Input Data:
${context.slice(0, 10000)}

Rules:
1. Output ONLY the crystallized insight.
2. Discard noise, formatting, and temporary details.
3. Focus on the core fact, probability, or event.
4. Max 50 words.
        `.trim();

        const response = await runTurn([
            { role: 'system', content: 'You are a precise data summarizer.' },
            { role: 'user', content: prompt }
        ]);

        if (!response.success) return 'Unable to crystallize: LLM unavailable.';
        return response.content.trim();
    }

    /**
     * Build analysis prompt using Shell snapshot
     */
    private buildSnapshotAnalysisPrompt(snapshotContext: string, question?: string): string {
        const taskDescription = question ||
            'Analyze the wired and pinned blocks in this shell and provide your perspective based on your persona. What patterns, insights, or concerns do you observe across the data streams?';

        return `${snapshotContext}

---

## Your Task

${taskDescription}

**Instructions:**
- Consider only the blocks listed above (wired or pinned in this shell), their relationships, and current state; do not assume anything about blocks that are not listed
- Pay special attention to FOCUSED BLOCKS (📌) - these have been pinned for deep analysis
- Note the status and freshness of data across different streams
- Respond concisely but thoroughly, being specific about what the data tells you
- If you find information critical for long-term retention, output it on a separate line starting with "SUGGEST_MEMORY: "`;
    }

    /**
     * Gather data from Shell blocks (legacy method, kept for compatibility)
     */
    private gatherBlockData(): BlockDataSummary[] {
        const blockStore = useBlockStore.getState();
        const blocks = blockStore.blocks;

        return blocks.map((block: BlockInstance) => {
            // Extract key info based on block type
            const blockType = block.schema.block_id;
            const summary = this.summarizeBlockData(blockType, block.data);

            return {
                type: blockType,
                title: block.schema.display_name || blockType,
                summary,
                keyMetrics: this.extractKeyMetrics(blockType, block.data),
                timestamp: block.last_updated ?? undefined
            };
        });
    }

    /**
     * Summarize block data for context
     */
    private summarizeBlockData(blockType: string, data: unknown): string {
        const d = isRecord(data) ? data : null;

        switch (blockType) {
            case 'polymarket': {
                const market = d && isRecord(d.market) ? d.market : null;
                if (market) {
                    const question = typeof market.question === 'string' ? market.question : '';
                    const yes = typeof market.yes_price === 'number' ? market.yes_price : 0.5;
                    const volume = typeof market.volume === 'number'
                        ? market.volume.toLocaleString()
                        : 'N/A';
                    return `Market: "${question}" - Current probability: ${Math.round(yes * 100)}% YES. Volume: $${volume}`;
                }
                return 'Polymarket block - no data loaded';
            }

            case 'tradingview': {
                if (d && typeof d.symbol === 'string') {
                    const interval = typeof d.interval === 'string' ? d.interval : '1D';
                    return `Chart: ${d.symbol} - ${interval} timeframe`;
                }
                return 'TradingView chart - no symbol configured';
            }

            case 'newsfeed': {
                const articles = d && Array.isArray(d.articles) ? d.articles : [];
                if (articles.length) {
                    const headlines = articles.slice(0, 3).map((a) =>
                        isRecord(a) && typeof a.title === 'string' ? a.title : ''
                    ).join('; ');
                    return `Recent headlines: ${headlines}`;
                }
                return 'News feed - no articles loaded';
            }

            case 'gdelt': {
                const events = d && Array.isArray(d.events) ? d.events : [];
                if (events.length) {
                    const categories = [...new Set(events.slice(0, 5).map((e) =>
                        isRecord(e) && typeof e.category === 'string' ? e.category : undefined
                    ).filter((c): c is string => !!c))];
                    return `${events.length} global events detected. Categories: ${categories.join(', ')}`;
                }
                return 'GDELT events - no data loaded';
            }

            default:
                return `${blockType} block with ${Object.keys(d || {}).length} data fields`;
        }
    }

    /**
     * Extract key metrics from block
     */
    private extractKeyMetrics(blockType: string, data: unknown): string[] {
        const metrics: string[] = [];
        const d = isRecord(data) ? data : null;
        const market = d && isRecord(d.market) ? d.market : null;

        if (blockType === 'polymarket' && market) {
            const yes = typeof market.yes_price === 'number' ? market.yes_price : 0.5;
            metrics.push(`YES: ${Math.round(yes * 100)}%`);
            if (typeof market.volume === 'number') metrics.push(`Vol: $${(market.volume / 1000).toFixed(0)}k`);
        }

        return metrics;
    }

    /**
     * Distribute insights to appropriate context pools
     */
    private distributeInsights(insights: ExtractedInsight[], persona: PersonaConfig): void {
        const mindStore = useMindStore.getState();

        for (const insight of insights) {
            let poolId: string;

            switch (insight.type) {
                case 'prediction':
                    poolId = 'predictions';
                    break;
                case 'directive':
                    poolId = 'directives';
                    break;
                case 'warning':
                case 'inference':
                case 'memory_suggestion':
                    poolId = 'inferences';
                    break;
                default:
                    poolId = 'observations';
            }

            const isMemorySuggestion = insight.type === 'memory_suggestion';
            const entryType: ContextEntryType =
                insight.type === 'memory_suggestion' || insight.type === 'warning'
                    ? 'inference'
                    : insight.type;

            mindStore.addToPool(poolId, {
                type: entryType,
                content: insight.content,
                importance: isMemorySuggestion ? 0.95 : (insight.confidence === 'high' ? 0.9 : insight.confidence === 'medium' ? 0.6 : 0.3),
                metadata: {
                    source: persona.name,
                    confidence: insight.confidence,
                    personaId: persona.id,
                    isMemorySuggestion: isMemorySuggestion
                }
            });
        }
    }
}

// ============================================
// TYPES
// ============================================

export interface ThinkResult {
    success: boolean;
    response?: string;
    insights?: ExtractedInsight[];
    tokensUsed?: number;
    error?: string;
}

// ============================================
// SINGLETON
// ============================================

let mindEngineInstance: MindEngine | null = null;

export function getMindEngine(): MindEngine {
    if (!mindEngineInstance) {
        mindEngineInstance = new MindEngine();
    }
    return mindEngineInstance;
}
