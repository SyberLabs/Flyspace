import { describe, expect, it, vi } from 'vitest';
import { chooseProvider, draftSession, DraftRefused, geminiReply, openAiReply } from '../../../scripts/lib/drafters';

const OPENAI_KEY = 'sk-test-openai-0123456789';
const GOOGLE_KEY = 'AIza-test-google-0123456789';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('which model drafts the spec', () => {
    it('takes --provider, else the first key present: Claude, OpenAI, Gemini', () => {
        expect(chooseProvider('google', { ANTHROPIC_API_KEY: 'x' })).toBe('google');
        expect(chooseProvider(undefined, { ANTHROPIC_API_KEY: 'x', OPENAI_API_KEY: 'y' })).toBe('anthropic');
        expect(chooseProvider(undefined, { OPENAI_API_KEY: 'y', GOOGLE_API_KEY: 'z' })).toBe('openai');
        expect(chooseProvider(undefined, { GOOGLE_API_KEY: 'z' })).toBe('google');
        expect(chooseProvider(undefined, {})).toBe('anthropic');
        expect(() => chooseProvider('deepseek', {})).toThrow(/anthropic, openai or google/);
    });
});

describe('reading replies', () => {
    it('OpenAI: the text, a refusal, or a cut-off draft', () => {
        expect(openAiReply({ choices: [{ finish_reason: 'stop', message: { content: '{"openapi":"3.0.3"}' } }] })).toBe('{"openapi":"3.0.3"}');
        expect(() => openAiReply({ choices: [{ message: { content: null, refusal: 'no' } }] })).toThrow(DraftRefused);
        expect(() => openAiReply({ choices: [{ finish_reason: 'length', message: { content: '{' } }] })).toThrow(/output limit/);
    });

    it('Gemini: the text without thought parts, a block, or a cut-off draft', () => {
        expect(geminiReply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking…', thought: true }, { text: '{"a":1}' }] } }] })).toBe('{"a":1}');
        expect(() => geminiReply({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow(DraftRefused);
        expect(() => geminiReply({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{' }] } }] })).toThrow(/output limit/);
    });
});

describe('OpenAI session', () => {
    it('sends the key only as a bearer header, and keeps the conversation across repair rounds', async () => {
        const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ choices: [{ finish_reason: 'stop', message: { content: '{"draft":true}' } }] }));
        const session = draftSession('openai', 'SYSTEM', { env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: fetchMock as unknown as typeof fetch });
        expect(session.model).toBe('gpt-5');
        await session.send(['<document>docs</document>', 'Write the spec.']);
        await session.send(['Fix these problems.']);
        const [url, init] = fetchMock.mock.calls[1];
        expect(String(url)).toBe('https://api.openai.com/v1/chat/completions');
        expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${OPENAI_KEY}`);
        const body = JSON.parse(String(init?.body)) as { model: string; messages: { role: string; content: string }[] };
        expect(body.model).toBe('gpt-5');
        expect(body.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
        expect(body.messages[2].content).toBe('{"draft":true}');
        expect(String(init?.body)).not.toContain(OPENAI_KEY);
    });

    it('reports an HTTP error by status and the provider\'s message, not the body', async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ error: { message: 'Incorrect API key provided' }, debug: 'internal' }, 401));
        const session = draftSession('openai', 'SYSTEM', { env: { OPENAI_API_KEY: OPENAI_KEY }, fetch: fetchMock as unknown as typeof fetch });
        await expect(session.send(['x'])).rejects.toThrow('OpenAI API error 401: Incorrect API key provided');
    });

    it('says which variable to set when there is no key', () => {
        expect(() => draftSession('openai', 'SYSTEM', { env: {} })).toThrow('no OpenAI key (set OPENAI_API_KEY in .env)');
    });
});

describe('Gemini session', () => {
    it('sends the key in a header, never the URL, and asks for JSON', async () => {
        const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"draft":true}' }] } }] }));
        const session = draftSession('google', 'SYSTEM', { env: { GOOGLE_API_KEY: GOOGLE_KEY }, fetch: fetchMock as unknown as typeof fetch });
        expect(await session.send(['docs'])).toBe('{"draft":true}');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent');
        expect(String(url)).not.toContain(GOOGLE_KEY);
        expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(GOOGLE_KEY);
        const body = JSON.parse(String(init?.body)) as { systemInstruction: unknown; generationConfig: { responseMimeType: string } };
        expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYSTEM' }] });
        expect(body.generationConfig.responseMimeType).toBe('application/json');
    });

    it('refuses a model name that could change the URL path', () => {
        expect(() => draftSession('google', 'SYSTEM', { model: '../../v1/files', env: { GOOGLE_API_KEY: GOOGLE_KEY } })).toThrow(/not a Gemini model name/);
    });
});
