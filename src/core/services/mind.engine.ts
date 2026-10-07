// ============================================
// PROJECT OMNI: MIND ENGINE
// The reasoning core that makes the Mind think
// ============================================

import { LLMMessage } from './llm.service';
import { runTurn } from '@/core/cognition';
import {
    getPersonaSystemPrompt,
    parseInsightsFromResponse,
    ExtractedInsight
} from './persona.prompts';
import { captureShellSnapshot, formatSnapshotForLLM } from './shell.snapshot';
import { useMindStore } from '@/core/stores';

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
            // active shell, nothing else. Nothing in scope is only a refusal
            // for a context-only Think; an explicit question (Quick Ask) runs.
            const snapshot = captureShellSnapshot();

            if (snapshot.totalBlocks === 0 && !question?.trim()) {
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
