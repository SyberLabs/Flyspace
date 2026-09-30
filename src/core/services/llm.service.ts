// ============================================
// PROJECT OMNI: LLM SERVICE (client)
// Thin client that proxies all LLM calls through the server-side /api/llm
// route. No provider API keys ever live in the browser — they are read from
// process.env on the server.
// ============================================

import { LLMConfig } from '@/core/schemas/mind.schema';
import type { ContextSource } from '@/core/schemas/wire.schema';

// ============================================
// TYPES (public interface preserved for callers)
// ============================================

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMOptions {
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    /** Abort the in-flight fetch. Never serialized onto the request body. */
    signal?: AbortSignal;
    /** Reuse this value when retrying the same logical inference operation. */
    idempotencyKey?: string;
    /**
     * What fed this turn. Sent to the server for the inference ledger only —
     * providers never see it. Omitted when the caller has no provenance to
     * report (the Mind panel's shell snapshot, skin generation).
     */
    sources?: ContextSource[];
    /**
     * Called with the ledger row id as soon as the response headers arrive,
     * before any token. A callback rather than a return value because the
     * streaming path yields chunks and its consumers use `for await`, which
     * discards a generator's return. Never called when the server recorded
     * nothing (no database configured).
     */
    onRunId?: (runId: string) => void;
}

export interface LLMResponse {
    content: string;
    tokensUsed?: number;
    finishReason?: string;
}

const LLM_ENDPOINT = '/api/llm';

/**
 * Set by /api/llm when the inference ledger recorded this call. Exported so a
 * test can assert it still matches the route's own constant — the two halves
 * of this contract cannot import each other, and a silent divergence would
 * disable cascade lineage without failing anything.
 */
export const RUN_ID_HEADER = 'X-Omni-Run-Id';

function idempotencyKey(value?: string): string {
    return value ?? globalThis.crypto.randomUUID();
}

async function throwIfReplayed(res: Response, onRunId?: (runId: string) => void): Promise<void> {
    if (res.headers.get('Idempotency-Replayed') !== 'true') return;
    reportRunId(res, onRunId);
    const data = await res.json().catch(() => ({}));
    throw new Error(`Inference request was already accepted (${data.status ?? 'status unavailable'}).`);
}

/** Hand the caller the ledger row id, if the server reported one. */
function reportRunId(res: Response, onRunId?: (runId: string) => void): void {
    if (!onRunId) return;
    const runId = res.headers.get(RUN_ID_HEADER);
    if (runId) onRunId(runId);
}

function abortError(): Error {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
}

// ============================================
// LLM SERVICE
// ============================================

export class LLMService {
    private config: LLMConfig;

    constructor(config: LLMConfig) {
        this.config = config;
    }

    get providerName(): LLMConfig['provider'] {
        return this.config.provider;
    }

    /**
     * Lightweight availability probe. Uses the route's `mode: 'ping'` which
     * checks key presence for cloud providers and pings Ollama for local —
     * WITHOUT running a real completion. Returns the server's `available` flag.
     */
    async isAvailable(): Promise<boolean> {
        try {
            const res = await fetch(LLM_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    mode: 'ping',
                    provider: this.config.provider,
                    baseUrl: this.config.baseUrl
                })
            });
            if (!res.ok) return false;
            const data = await res.json().catch(() => ({ available: false }));
            return data.available === true;
        } catch {
            return false;
        }
    }

    async complete(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
        const res = await fetch(LLM_ENDPOINT, {
            method: 'POST',
            signal: options?.signal,
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': idempotencyKey(options?.idempotencyKey)
            },
            body: JSON.stringify({
                provider: this.config.provider,
                model: this.config.model,
                baseUrl: this.config.baseUrl,
                messages,
                options: {
                    temperature: options?.temperature ?? this.config.temperature,
                    maxTokens: options?.maxTokens ?? this.config.maxTokens
                },
                sources: options?.sources
            })
        });

        await throwIfReplayed(res, options?.onRunId);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `LLM request failed: ${res.status}`);
        }

        reportRunId(res, options?.onRunId);
        return res.json();
    }

    async *stream(messages: LLMMessage[], options?: LLMOptions): AsyncGenerator<string> {
        const { signal, sources, onRunId, ...llmOptions } = options ?? {};
        const key = idempotencyKey(llmOptions.idempotencyKey);
        const res = await fetch(LLM_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            signal,
            body: JSON.stringify({
                provider: this.config.provider,
                model: this.config.model,
                baseUrl: this.config.baseUrl,
                messages,
                options: {
                    temperature: llmOptions.temperature ?? this.config.temperature,
                    maxTokens: llmOptions.maxTokens ?? this.config.maxTokens
                },
                sources,
                stream: true
            })
        });

        await throwIfReplayed(res, onRunId);
        if (!res.ok || !res.body) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `LLM stream failed: ${res.status}`);
        }

        // Before the first token: a cascade needs this even if the user stops
        // the stream a moment later, because the partial answer is still kept
        // and can still be cited by a downstream persona.
        reportRunId(res, onRunId);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let completed = false;
        try {
            while (true) {
                if (signal?.aborted) {
                    await reader.cancel();
                    throw abortError();
                }
                const { done, value } = await reader.read();
                if (done) { completed = true; break; }
                const chunk = decoder.decode(value, { stream: true });
                if (chunk) yield chunk;
            }
        } finally {
            if (!completed) {
                try { await reader.cancel(); } catch { /* Upstream may already be closed. */ }
            }
            try {
                reader.releaseLock();
            } catch {
                // Already released by cancel() or a completed read.
            }
        }
    }
}

// ============================================
// SINGLETON FACTORY
// ============================================

let currentService: LLMService | null = null;

export function getLLMService(config: LLMConfig): LLMService {
    if (!currentService || currentService.providerName !== config.provider) {
        currentService = new LLMService(config);
    }
    return currentService;
}

export function createLLMService(config: LLMConfig): LLMService {
    return new LLMService(config);
}
