// The model behind the spec forge (scripts/forge-spec.ts): Claude, OpenAI or
// Gemini. Each is a session that keeps its own conversation in its native
// shape, so a repair round continues the same conversation. The key is read
// from the environment and sent only in the request's own header; no error
// message here repeats a response body.

import Anthropic from '@anthropic-ai/sdk';

export type DraftProvider = 'anthropic' | 'openai' | 'google';

export const DEFAULT_MODELS: Record<DraftProvider, string> = {
    anthropic: 'claude-opus-5-5',
    openai: 'gpt-5',
    google: 'gemini-2.5-pro'
};

const KEY_ENV: Record<Exclude<DraftProvider, 'anthropic'>, string> = {
    openai: 'OPENAI_API_KEY',
    google: 'GOOGLE_API_KEY'
};

const MAX_OUTPUT_TOKENS = 64_000;
const REQUEST_TIMEOUT_MS = 10 * 60_000;

export interface DraftSession {
    provider: DraftProvider;
    model: string;
    /** Send one user turn (the first carries the documents) and return the reply's text. */
    send(userText: string[]): Promise<string>;
}

/** The provider asked for, or the first one with a key: Claude, then OpenAI, then Gemini. */
export function chooseProvider(requested: string | undefined, env: Record<string, string | undefined> = process.env): DraftProvider {
    if (requested !== undefined) {
        if (requested === 'anthropic' || requested === 'openai' || requested === 'google') return requested;
        throw new Error(`--provider must be anthropic, openai or google, not ${requested}`);
    }
    if (env.ANTHROPIC_API_KEY?.trim()) return 'anthropic';
    if (env.OPENAI_API_KEY?.trim()) return 'openai';
    if (env.GOOGLE_API_KEY?.trim()) return 'google';
    // No key at all: Claude, which can also use an `ant auth login` profile.
    return 'anthropic';
}

export class DraftRefused extends Error {}

// ---- reading replies (pure, so they are tested without a network) ----------

/** The text of an OpenAI chat completion, or why there is none. */
export function openAiReply(body: unknown): string {
    const choice = (body as { choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }[] }).choices?.[0];
    if (!choice?.message) throw new Error('OpenAI sent no reply');
    if (typeof choice.message.refusal === 'string' && choice.message.refusal) throw new DraftRefused('OpenAI declined to draft this spec');
    if (choice.finish_reason === 'length') throw new Error('the draft ran past the output limit');
    if (choice.finish_reason === 'content_filter') throw new DraftRefused('OpenAI filtered the draft');
    if (typeof choice.message.content !== 'string' || !choice.message.content) throw new Error('OpenAI sent an empty reply');
    return choice.message.content;
}

/** The text of a Gemini reply (thought parts left out), or why there is none. */
export function geminiReply(body: unknown): string {
    const value = body as {
        promptFeedback?: { blockReason?: string };
        candidates?: { finishReason?: string; content?: { parts?: { text?: unknown; thought?: unknown }[] } }[];
    };
    if (value.promptFeedback?.blockReason) throw new DraftRefused(`Gemini blocked the request (${value.promptFeedback.blockReason})`);
    const candidate = value.candidates?.[0];
    if (!candidate) throw new Error('Gemini sent no reply');
    if (candidate.finishReason === 'MAX_TOKENS') throw new Error('the draft ran past the output limit');
    if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'RECITATION' || candidate.finishReason === 'PROHIBITED_CONTENT') {
        throw new DraftRefused(`Gemini stopped the draft (${candidate.finishReason})`);
    }
    const text = (candidate.content?.parts ?? [])
        .filter(part => part.thought !== true && typeof part.text === 'string')
        .map(part => part.text as string)
        .join('\n');
    if (!text) throw new Error('Gemini sent an empty reply');
    return text;
}

/** An HTTP failure as a short line: the status and the provider's own error message, never the body. */
async function httpFailure(provider: string, response: Response): Promise<Error> {
    let message = '';
    try {
        const body = await response.json() as { error?: { message?: unknown } };
        if (typeof body.error?.message === 'string') message = `: ${body.error.message.slice(0, 200)}`;
    } catch {
        // Not JSON: the status says enough.
    }
    return new Error(`${provider} API error ${response.status}${message}`);
}

function keyFor(provider: Exclude<DraftProvider, 'anthropic'>, env: Record<string, string | undefined>): string {
    const key = env[KEY_ENV[provider]]?.trim();
    if (!key) throw new Error(`no ${provider === 'openai' ? 'OpenAI' : 'Gemini'} key (set ${KEY_ENV[provider]} in .env)`);
    return key;
}

// ---- sessions ---------------------------------------------------------------

function anthropicSession(system: string, model: string): DraftSession {
    const client = new Anthropic();
    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    return {
        provider: 'anthropic',
        model,
        async send(userText) {
            messages.push({ role: 'user', content: userText.map(text => ({ type: 'text' as const, text })) });
            const stream = client.beta.messages.stream({
                model,
                max_tokens: MAX_OUTPUT_TOKENS,
                system,
                thinking: { type: 'adaptive' },
                output_config: { effort: 'high' },
                // On a policy decline, re-run on a suitable model instead of stopping.
                betas: ['server-side-fallback-2026-07-01'],
                fallbacks: 'default',
                messages
            } as Parameters<typeof client.beta.messages.stream>[0]);
            const message = await stream.finalMessage();
            if (message.stop_reason === 'refusal') throw new DraftRefused('Claude declined to draft this spec');
            if (message.stop_reason === 'max_tokens') throw new Error('the draft ran past max_tokens');
            // Keep the whole reply, thinking included, so the next turn continues the same conversation.
            messages.push({ role: 'assistant', content: message.content });
            return message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n');
        }
    };
}

function openAiSession(system: string, model: string, env: Record<string, string | undefined>, fetchImpl: typeof fetch): DraftSession {
    const key = keyFor('openai', env);
    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [{ role: 'system', content: system }];
    return {
        provider: 'openai',
        model,
        async send(userText) {
            messages.push({ role: 'user', content: userText.join('\n\n') });
            const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
                body: JSON.stringify({ model, messages, max_completion_tokens: MAX_OUTPUT_TOKENS })
            });
            if (!response.ok) throw await httpFailure('OpenAI', response);
            const text = openAiReply(await response.json());
            messages.push({ role: 'assistant', content: text });
            return text;
        }
    };
}

function geminiSession(system: string, model: string, env: Record<string, string | undefined>, fetchImpl: typeof fetch): DraftSession {
    const key = keyFor('google', env);
    if (!/^[a-z0-9.-]{1,64}$/i.test(model)) throw new Error('--model is not a Gemini model name');
    const contents: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];
    return {
        provider: 'google',
        model,
        async send(userText) {
            contents.push({ role: 'user', parts: userText.map(text => ({ text })) });
            const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
                method: 'POST',
                redirect: 'error',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: system }] },
                    contents,
                    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: 'application/json' }
                })
            });
            if (!response.ok) throw await httpFailure('Gemini', response);
            const text = geminiReply(await response.json());
            contents.push({ role: 'model', parts: [{ text }] });
            return text;
        }
    };
}

export function draftSession(
    provider: DraftProvider,
    system: string,
    options: { model?: string; env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}
): DraftSession {
    const model = options.model ?? DEFAULT_MODELS[provider];
    const env = options.env ?? process.env;
    const fetchImpl = options.fetch ?? fetch;
    if (provider === 'openai') return openAiSession(system, model, env, fetchImpl);
    if (provider === 'google') return geminiSession(system, model, env, fetchImpl);
    return anthropicSession(system, model);
}
