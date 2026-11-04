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
