// ============================================
// PROJECT OMNI: SERVER-SIDE LLM ADAPTERS
// Runs only on the server (imported by /api/llm route).
// API keys are read from process.env and never reach the client.
// ============================================

import 'server-only';

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

export interface ServerLLMRequest {
    provider: ServerLLMProvider;
    model: string;
    messages: LLMMessage[];
    options?: LLMOptions;
}

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 1024;

// ============================================
// OLLAMA (Local) — no key required
// ============================================

async function ollamaComplete(req: ServerLLMRequest): Promise<LLMResponse> {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
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
        throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return {
        content: data.message?.content || '',
        tokensUsed: data.eval_count,
        finishReason: data.done ? 'stop' : 'unknown'
    };
}

async function ollamaStream(req: ServerLLMRequest): Promise<ReadableStream<Uint8Array>> {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
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
        throw new Error(`Ollama stream error: ${response.status}`);
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
        throw new Error(`Anthropic error: ${response.status}`);
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
        throw new Error(`Google error: ${response.status}`);
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
            return true; // reachability is checked separately (see checkProviderAvailable)
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
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    try {
        const response = await fetch(`${baseUrl}/api/tags`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
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
 * Streaming is currently supported for local (Ollama). Cloud providers fall
 * back to a single-chunk stream of the completed response.
 */
export async function runStream(req: ServerLLMRequest): Promise<ReadableStream<Uint8Array>> {
    if (req.provider === 'local') {
        return ollamaStream(req);
    }
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
