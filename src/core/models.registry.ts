// ============================================
// PROJECT OMNI: MODEL REGISTRY (apex A5)
// Single source of truth for LLM model ids. Model names are config *data*
// and they decay — this project shipped two live 404s from deprecated ids
// (claude-3-haiku-20240307, gemini-2.0-flash-exp). The registry centralizes:
//   - the current default model per provider
//   - known-good model options
//   - a deprecated→replacement map used to self-heal persisted configs
//     (mindStore migration) AND stale client requests (/api/llm, server-side)
// ============================================

import type { LLMProvider } from './schemas/mind.schema';

interface ModelInfo {
    id: string;
    label: string;
    /**
     * Minimum sensible output-token budget. "Thinking" models (Gemini 2.5)
     * spend budget on internal reasoning before visible output — small caps
     * return empty/truncated text (learned live).
     */
    minOutputTokens?: number;
}

/** Known-good models per provider (verified or high-confidence current ids). */
export const MODEL_REGISTRY: Record<LLMProvider, ModelInfo[]> = {
    local: [
        // Local is whatever Ollama has pulled; this is only the default suggestion.
        { id: 'tinyllama', label: 'TinyLlama (Ollama)' }
    ],
    anthropic: [
        { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' }
    ],
    google: [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', minOutputTokens: 2048 },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', minOutputTokens: 2048 }
    ]
};

/** The default model per provider. */
export const DEFAULT_MODEL: Record<LLMProvider, string> = {
    local: 'tinyllama',
    anthropic: 'claude-haiku-4-5-20251001',
    google: 'gemini-2.5-flash'
};

/**
 * Known-dead model ids → their replacement. Only ids we KNOW are retired
 * belong here (guessing would break valid configs).
 */
export const DEPRECATED_MODELS: Record<string, string> = {
    // Shipped live 404s in this project:
    'gemini-2.0-flash-exp': 'gemini-2.5-flash',
    'claude-3-haiku-20240307': 'claude-haiku-4-5-20251001',
    // Google retired the 1.5 API line:
    'gemini-1.5-flash': 'gemini-2.5-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro'
};

/**
 * Resolve a model id to something safe to call:
 * empty → provider default; known-dead → replacement; otherwise passthrough
 * (users may run valid models the registry doesn't list).
 */
export function resolveModel(provider: LLMProvider, modelId?: string): string {
    const id = modelId?.trim();
    if (!id) return DEFAULT_MODEL[provider];
    return DEPRECATED_MODELS[id] ?? id;
}

/** Look up registry info for a model id (undefined if unlisted). */
export function getModelInfo(modelId: string): ModelInfo | undefined {
    for (const models of Object.values(MODEL_REGISTRY)) {
        const found = models.find(m => m.id === modelId);
        if (found) return found;
    }
    return undefined;
}

/** Minimum output-token budget for a model (0 if unknown/not applicable). */
export function minOutputTokensFor(modelId: string): number {
    return getModelInfo(modelId)?.minOutputTokens ?? 0;
}
