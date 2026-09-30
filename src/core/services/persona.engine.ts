// ============================================
// PROJECT OMNI: PERSONA ENGINE
// The real "Think over wired data" loop for persona BLOCKS.
// Connects aggregateWireContext (the data half) to getLLMService (the LLM half)
// — replacing the former setTimeout placeholder in PersonaBlock.
// Shared by both chat (handleSendMessage) and autonomous Think (handleThink).
// ============================================

import { LLMMessage } from './llm.service';
import { aggregateWireContext } from './wire.service';
import { runTurnStream } from '@/core/cognition';
import { PERSONA_CONFIGS, PersonaChatMessage, ContextSource } from '@/core/schemas/wire.schema';
import { PersonaType } from '@/core/schemas/shell.schema';

const MAX_HISTORY = 10;
// Generous budget: "thinking" models (e.g. Gemini 2.5) spend part of the token
// budget on internal reasoning before producing visible output, so a small cap
// can truncate the answer to nothing.
const MAX_TOKENS = 2048;

/**
 * Build a system prompt for a persona block from its type. Self-contained on
 * PERSONA_CONFIGS so the persona-block path doesn't depend on the Mind store's
 * separately-keyed personas.
 */
export function buildPersonaSystemPrompt(personaType: PersonaType, customName?: string): string {
    const cfg = PERSONA_CONFIGS[personaType];
    const name = customName || cfg.name;
    return `You are ${name} ${cfg.avatar}, an AI persona within "The Citadel" — a spatial command center for truth-seeking and strategic intelligence.

Your focus: ${cfg.description}.

You reason over data streams that the user has wired directly into you (prediction markets, news, economic series, crypto, forecasts, notes, etc.). When you answer:
- Ground every claim in the wired data below; cite specific values when you can.
- Be explicit about uncertainty and when the data is insufficient.
- Stay in character for your focus, but be concise and useful.
- If no data is wired in, say so and answer from general reasoning, noting the limitation.`;
}

export interface PersonaTurnInput {
    instanceId: string;
    personaType: PersonaType;
    customName?: string;
    /** Recent conversation history (most recent last). */
    history?: PersonaChatMessage[];
    /** The user's message. Omit for autonomous Think. */
    userMessage?: string;
    /** Fired once after context is assembled, before any token. */
    onPrepared?: (sources: ContextSource[]) => void;
    /** Halt the in-flight stream. Partial tokens are kept. */
    abortSignal?: AbortSignal;
}

export interface PersonaTurnPrepared {
    messages: LLMMessage[];
    sourceIds: string[];
    /** Labelled provenance for the UI: wired blocks and ambient pools. */
    sources: ContextSource[];
    /** Whether any wired data context was found. */
    hasContext: boolean;
}

const DEFAULT_THINK_TASK =
    'Analyze the data wired into you and share your most useful observation right now. ' +
    'Note patterns, risks, or anomalies, and flag anything the data cannot tell us.';

/**
 * Assemble the LLM messages for a persona turn: system prompt + fresh wired
 * context + recent history + the user task. Pure (no network) for easy testing.
 */
export function preparePersonaTurn(input: PersonaTurnInput): PersonaTurnPrepared {
    const { context, sourceIds, sources } = aggregateWireContext(input.instanceId);
    // aggregateWireContext returns a human sentinel string when nothing is
    // wired and another when every wired source is empty, so presence of real
    // context is keyed off sourceIds, not the text.
    const hasContext = sourceIds.length > 0;

    const system = buildPersonaSystemPrompt(input.personaType, input.customName);

    // The sentinels say which case it is, so the persona is not told nothing is
    // wired when wires exist but carried no data.
    const contextBlock = `## Wired Data Context\n\n${context}`;

    const task = input.userMessage?.trim() || DEFAULT_THINK_TASK;

    const history: LLMMessage[] = (input.history || [])
        .slice(-MAX_HISTORY)
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const messages: LLMMessage[] = [
        { role: 'system', content: system },
        ...history,
        { role: 'user', content: `${contextBlock}\n\n---\n\n${task}` }
    ];

    return { messages, sourceIds, sources, hasContext };
}

export interface PersonaTurnResult {
    success: boolean;
    content?: string;
    sourceIds: string[];
    /** What actually fed this turn — record this, not the block's wires. */
    sources: ContextSource[];
    error?: string;
    /** User halted the stream. Partial `content` is kept. */
    stopped?: boolean;
    /** Inference-ledger row id for this turn, when one was recorded. */
    runId?: string;
}

/**
 * Stream a persona turn. Yields response chunks; returns a final result.
 * Fails closed with a clear message when no provider is available.
 */
export async function* streamPersonaTurn(
    input: PersonaTurnInput
): AsyncGenerator<string, PersonaTurnResult> {
    const { messages, sourceIds, sources } = preparePersonaTurn(input);
    input.onPrepared?.(sources);

    // The Cognition Kernel owns the turn lifecycle (availability, registry
    // token floor, streaming, fail-closed errors) — apex A4.
    // `sources` rides along for the server-side ledger: the provenance the
    // canvas shows in a chip is the provenance the run is recorded with.
    const turn = runTurnStream(messages, {
        maxTokens: MAX_TOKENS,
        signal: input.abortSignal,
        sources
    });
    let step = await turn.next();
    while (!step.done) {
        yield step.value;
        step = await turn.next();
    }
    const result = step.value;

    const { runId } = result;

    if (result.stopped) {
        return { success: true, content: result.content, sourceIds, sources, stopped: true, runId };
    }

    return result.success
        ? { success: true, content: result.content, sourceIds, sources, runId }
        : { success: false, sourceIds, sources, error: result.error, runId };
}
