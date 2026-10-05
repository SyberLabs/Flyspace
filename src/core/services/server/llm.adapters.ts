// ============================================
// PROJECT OMNI: SERVER-SIDE LLM ADAPTERS
// Runs only on the server (imported by /api/llm route).
// API keys are read from process.env and never reach the client.
// ============================================

import 'server-only';
import { hostedAuthRequired } from '@/core/services/server/auth';

export interface LLMMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LLMOptions {
    temperature?: number;
    maxTokens?: number;
}

export interface LLMResponse {
    content: string;
    tokensUsed?: number;
    finishReason?: string;
}

export type ServerLLMProvider = 'local' | 'anthropic' | 'google';

/**
 * An upstream response is a known rejection only when the status is a
 * non-timeout, non-rate-limit 4xx. Timeouts, throttling, and 5xx responses
 * do not prove that provider work or billing did not happen.
 */
export class ProviderResponseError extends Error {
    readonly isDefinitiveRejection: boolean;

    constructor(message: string, readonly status: number) {
        super(message);
        this.name = 'ProviderResponseError';
        this.isDefinitiveRejection = status >= 400 && status < 500 && status !== 408 && status !== 429;
    }
}

export interface ServerLLMRequest {
    provider: ServerLLMProvider;
    model: string;
    messages: LLMMessage[];
    options?: LLMOptions;
    /** Direct adapter callers only. The HTTP route never forwards a client URL. */
    baseUrl?: string;
    signal?: AbortSignal;
}

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;

function ollamaBaseUrl(req: ServerLLMRequest): string {
    const configured = process.env.OLLAMA_BASE_URL?.trim();
    if (hostedAuthRequired()) {
        if (!configured) throw new Error('Local provider is disabled in hosted mode');
        const url = new URL(configured);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('Invalid hosted Ollama endpoint');
        }
        const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.') ||
            hostname.startsWith('169.254.') || hostname.startsWith('fe80:') || hostname === 'metadata.google.internal') {
            throw new Error('Hosted Ollama endpoint cannot use loopback or metadata destinations');
        }
        if (url.username || url.password || url.search || url.hash) {
            throw new Error('Invalid hosted Ollama endpoint');
        }
        return url.toString().replace(/\/$/, '');
    }
    return (req.baseUrl || configured || 'http://localhost:11434').replace(/\/$/, '');
}

// ============================================
// OLLAMA (Local) — no key required
// ============================================

async function ollamaComplete(req: ServerLLMRequest): Promise<LLMResponse> {
    const baseUrl = ollamaBaseUrl(req);
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        redirect: 'error',
        signal: req.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: req.model || 'tinyllama',
            messages: req.messages.map(m => ({ role: m.role, content: m.content })),
            stream: false,
            options: {
                temperature: req.options?.temperature ?? DEFAULT_TEMPERATURE,
                num_predict: req.options?.maxTokens ?? DEFAULT_MAX_TOKENS
            }
        })
    });

    if (!response.ok) {
        throw new ProviderResponseError(`Ollama error: ${response.status} ${response.statusText}`, response.status);
    }

    const data = await response.json();
    return {
        content: data.message?.content || '',
        tokensUsed: data.eval_count,
        finishReason: data.done ? 'stop' : 'unknown'
    };
}

async function ollamaStream(req: ServerLLMRequest): Promise<ReadableStream<Uint8Array>> {
    const baseUrl = ollamaBaseUrl(req);
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        redirect: 'error',
        signal: req.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: req.model || 'tinyllama',
            messages: req.messages.map(m => ({ role: m.role, content: m.content })),
            stream: true,
            options: {
                temperature: req.options?.temperature ?? DEFAULT_TEMPERATURE,
                num_predict: req.options?.maxTokens ?? DEFAULT_MAX_TOKENS
            }
        })
    });

    if (!response.ok || !response.body) {
        throw new ProviderResponseError(`Ollama stream error: ${response.status}`, response.status);
    }

    // Re-emit just the text deltas as a plain text stream.
    return transformLineDeltaStream(response.body, (line) => {
        try {
            const data = JSON.parse(line);
            return data.message?.content ?? '';
        } catch {
            return '';
        }
    });
}

// ============================================
// ANTHROPIC
// ============================================

async function anthropicComplete(req: ServerLLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server');

    const systemMessage = req.messages.find(m => m.role === 'system');
    const chatMessages = req.messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        redirect: 'error',
        signal: req.signal,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
            model: req.model,
            max_tokens: req.options?.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: systemMessage?.content,
            messages: chatMessages.map(m => ({ role: m.role, content: m.content }))
        })
    });

    if (!response.ok) {
        throw new ProviderResponseError(`Anthropic error: ${response.status}`, response.status);
    }

    const data = await response.json();
    return {
        content: data.content?.[0]?.text || '',
        tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
        finishReason: data.stop_reason
    };
}

// ============================================
// GOOGLE (Gemini)
// ============================================

async function googleComplete(req: ServerLLMRequest): Promise<LLMResponse> {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured on the server');

    const systemInstruction = req.messages.find(m => m.role === 'system')?.content;
    const contents = req.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
        }));

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`,
        {
            method: 'POST',
            redirect: 'error',
            signal: req.signal,
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
                contents,
                generationConfig: {
                    temperature: req.options?.temperature ?? DEFAULT_TEMPERATURE,
                    maxOutputTokens: req.options?.maxTokens ?? DEFAULT_MAX_TOKENS
                }
            })
        }
    );

    if (!response.ok) {
        throw new ProviderResponseError(`Google error: ${response.status}`, response.status);
    }

    const data = await response.json();
    return {
        content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
        tokensUsed: data.usageMetadata?.totalTokenCount,
        finishReason: data.candidates?.[0]?.finishReason
    };
}

// ============================================
// PUBLIC ENTRY POINTS
// ============================================

/** Whether the server has what it needs to serve this provider (sync, no I/O). */
export function isProviderConfigured(provider: ServerLLMProvider): boolean {
    switch (provider) {
        case 'local':
            if (!hostedAuthRequired()) return true; // reachability is checked separately (see checkProviderAvailable)
            try { ollamaBaseUrl({ provider, model: '', messages: [] }); return true; }
            catch { return false; }
        case 'anthropic':
            return !!process.env.ANTHROPIC_API_KEY;
        case 'google':
            return !!process.env.GOOGLE_API_KEY;
        default:
            return false;
    }
}

/**
 * Lightweight availability check. For cloud providers this is just key
 * presence; for local it actually pings Ollama's /api/tags (cheap, no
 * generation). Used by the route's `mode: 'ping'` so the client can probe
 * availability without triggering a real (and possibly failing) completion.
 */
export async function checkProviderAvailable(req: ServerLLMRequest): Promise<boolean> {
    if (req.provider !== 'local') {
        return isProviderConfigured(req.provider);
    }
    let baseUrl: string;
    try { baseUrl = ollamaBaseUrl(req); }
    catch { return false; }
    try {
        const response = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.any([
                req.signal ?? new AbortController().signal,
                AbortSignal.timeout(2_000)
            ])
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function runComplete(req: ServerLLMRequest): Promise<LLMResponse> {
    switch (req.provider) {
        case 'local':
            return ollamaComplete(req);
        case 'anthropic':
            return anthropicComplete(req);
        case 'google':
            return googleComplete(req);
        default:
            throw new Error(`Unsupported provider: ${req.provider}`);
    }
}

/**
 * Whether `runStream` passes this provider's bytes through as they arrive.
 * Only Ollama streams today. The other adapters complete the whole answer
 * and hand it over as one chunk, so a ledger row for them must not say
 * `streamed: true` (INFERENCE_LEDGER.md, "What `streamed` means").
 *
 * A capability statement for the ledger only. It never selects a code path:
 * `runStream` dispatches on the provider itself, so marking a provider
 * streamable here cannot send it to another provider's endpoint.
 */
export function providerStreams(provider: ServerLLMProvider): boolean {
    return provider === 'local';
}

/**
 * Streaming is currently supported for local (Ollama). Cloud providers fall
 * back to a single-chunk stream of the completed response; see
 * `providerStreams`.
 */
export async function runStream(req: ServerLLMRequest): Promise<ReadableStream<Uint8Array>> {
    switch (req.provider) {
        case 'local':
            return ollamaStream(req);
        case 'anthropic':
        case 'google':
            return bufferedStream(req);
        default:
            throw new Error(`Unsupported provider: ${req.provider}`);
    }
}

/** The completed answer as a one-chunk stream, for adapters with no streaming path. */
async function bufferedStream(req: ServerLLMRequest): Promise<ReadableStream<Uint8Array>> {
    const result = await runComplete(req);
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(result.content));
            controller.close();
        }
    });
}

// ============================================
// HELPERS
// ============================================

/**
 * Transform an NDJSON-ish byte stream into a plain-text stream by applying
 * `extract` to each complete line and emitting the returned text.
 */
function transformLineDeltaStream(
    source: ReadableStream<Uint8Array>,
    extract: (line: string) => string
): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let buffer = '';

    return new ReadableStream({
        async pull(controller) {
            const { done, value } = await reader.read();
            if (done) {
                if (buffer.trim()) {
                    const text = extract(buffer);
                    if (text) controller.enqueue(encoder.encode(text));
                }
                controller.close();
                return;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                if (!line.trim()) continue;
                const text = extract(line);
                if (text) controller.enqueue(encoder.encode(text));
            }
        },
        cancel() {
            reader.cancel();
        }
    });
}
