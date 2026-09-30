// ============================================
// PROJECT OMNI: COGNITION KERNEL (apex A4)
// The ONE turn lifecycle for every cognitive engine in the system:
//
//     availability → options (registry token floor) → stream/complete
//     → accumulate → fail-closed with an actionable message
//
// Before the kernel, four engines (persona, mind, systemMind, coreMind)
// plus two services (relationModeler, skin) each re-implemented this
// ~30-50 line lifecycle with subtle divergences (differing availability
// checks, error texts, token budgets). Now they are thin callers that own
// only their DOMAIN knowledge — context assembly, prompts, memory pools —
// and delegate the turn itself here. This resolves the long-parked
// "two Mind engines" question: one engine, many context sources.
// ============================================

import { getLLMService, LLMMessage, LLMOptions } from '@/core/services/llm.service';
import { useMindStore } from '@/core/stores/mindStore';
import { minOutputTokensFor } from '@/core/models.registry';
import type { LLMConfig } from '@/core/schemas/mind.schema';
import type { ContextSource } from '@/core/schemas/wire.schema';

export interface TurnOptions {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    /**
     * What fed this turn. Passed through to the server for the inference
     * ledger; it does not change the prompt. Only callers that know their
     * provenance supply it — the persona path does, the shell-snapshot and
     * skin paths do not.
     */
    sources?: ContextSource[];
}

export interface TurnResult {
    success: boolean;
    /** Full response text ('' on failure). */
    content: string;
    error?: string;
    tokensUsed?: number;
    /** User halted the stream. Partial `content` is kept. */
    stopped?: boolean;
    /**
     * Inference-ledger row id for this turn, when the server recorded one.
     * A caller that stores it can later be cited as a source by name, which
     * is what makes a cascade's lineage walkable. Absent without Postgres.
     */
    runId?: string;
}

/** The one actionable "no LLM" message, everywhere. */
export function unavailableMessage(config: LLMConfig): string {
    return config.provider === 'local'
        ? 'No LLM available — make sure Ollama is running (localhost:11434).'
        : `No LLM available — set the ${config.provider} API key in .env.`;
}

/**
 * Effective LLM options: caller overrides fall back to the active config,
 * and the model registry floors the output budget (thinking models like
 * Gemini 2.5 return empty text under small caps — learned live).
 */
function effectiveOptions(config: LLMConfig, options?: TurnOptions): LLMOptions {
    return {
        temperature: options?.temperature ?? config.temperature,
        maxTokens: Math.max(
            options?.maxTokens ?? config.maxTokens,
            minOutputTokensFor(config.model)
        ),
        signal: options?.signal,
        sources: options?.sources
    };
}

interface AvailabilityCheck {
    ok: boolean;
    config: LLMConfig;
    error?: string;
}

/** Shared availability gate (ping-based; no generation). */
export async function checkLLMAvailable(): Promise<AvailabilityCheck> {
    const { llmConfig } = useMindStore.getState();
    const llm = getLLMService(llmConfig);
    const ok = await llm.isAvailable();
    return ok
        ? { ok: true, config: llmConfig }
        : { ok: false, config: llmConfig, error: unavailableMessage(llmConfig) };
}

/**
 * Run a complete (non-streaming) turn. Never throws — fails closed with an
 * actionable error in the result.
 */
export async function runTurn(messages: LLMMessage[], options?: TurnOptions): Promise<TurnResult> {
    const avail = await checkLLMAvailable();
    if (!avail.ok) return { success: false, content: '', error: avail.error };

    let runId: string | undefined;
    try {
        const llm = getLLMService(avail.config);
        const response = await llm.complete(messages, {
            ...effectiveOptions(avail.config, options),
            onRunId: (id) => { runId = id; }
        });
        return { success: true, content: response.content, tokensUsed: response.tokensUsed, runId };
    } catch (err) {
        return {
            success: false,
            content: '',
            error: err instanceof Error ? err.message : 'LLM request failed.'
        };
    }
}

/**
 * Run a streaming turn. Yields chunks; returns the final TurnResult with the
 * accumulated content. Never throws — fails closed in the result.
 */
export async function* runTurnStream(
    messages: LLMMessage[],
    options?: TurnOptions
): AsyncGenerator<string, TurnResult> {
    const avail = await checkLLMAvailable();
    if (!avail.ok) return { success: false, content: '', error: avail.error };

    const llm = getLLMService(avail.config);
    let full = '';
    // Captured from the response headers before the first token, so it is
    // available on every outcome below — including a user Stop, whose partial
    // answer is kept and can still feed a downstream persona.
    let runId: string | undefined;
    try {
        const streamOptions = {
            ...effectiveOptions(avail.config, options),
            onRunId: (id: string) => { runId = id; }
        };
        for await (const chunk of llm.stream(messages, streamOptions)) {
            full += chunk;
            yield chunk;
        }
        return { success: true, content: full, runId };
    } catch (err) {
        if (isAbortError(err)) {
            return { success: true, content: full, stopped: true, runId };
        }
        return {
            success: false,
            content: '',
            error: err instanceof Error ? err.message : 'LLM request failed.',
            runId
        };
    }
}

function isAbortError(err: unknown): boolean {
    return err instanceof Error && err.name === 'AbortError';
}
