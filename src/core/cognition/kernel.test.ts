import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runTurn, runTurnStream, unavailableMessage } from './kernel';
import { useMindStore } from '@/core/stores/mindStore';
import type { LLMConfig } from '@/core/schemas/mind.schema';

// Mock the LLM service — kernel tests cover the TURN LIFECYCLE, not the network.
const mockService = {
    isAvailable: vi.fn(),
    complete: vi.fn(),
    stream: vi.fn()
};
vi.mock('@/core/services/llm.service', () => ({
    getLLMService: () => mockService
}));

function setConfig(config: Partial<LLMConfig>) {
    useMindStore.setState({
        llmConfig: {
            provider: 'local',
            model: 'tinyllama',
            temperature: 0.7,
            maxTokens: 1024,
            ...config
        }
    } as never);
}

beforeEach(() => {
    mockService.isAvailable.mockReset();
    mockService.complete.mockReset();
    mockService.stream.mockReset();
});

describe('runTurn — the one turn lifecycle (apex A4)', () => {
    it('returns content + tokens on success', async () => {
        setConfig({});
        mockService.isAvailable.mockResolvedValue(true);
        mockService.complete.mockResolvedValue({ content: 'grounded answer', tokensUsed: 42 });

        const result = await runTurn([{ role: 'user', content: 'q' }]);

        expect(result).toEqual({ success: true, content: 'grounded answer', tokensUsed: 42 });
    });

    it('floors maxTokens via the model registry (thinking models)', async () => {
        setConfig({ provider: 'google', model: 'gemini-2.5-flash' });
        mockService.isAvailable.mockResolvedValue(true);
        mockService.complete.mockResolvedValue({ content: 'x' });

        await runTurn([{ role: 'user', content: 'q' }], { maxTokens: 100 });

        expect(mockService.complete).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ maxTokens: 2048 }) // registry floor wins
        );
    });

    it('fails closed with the provider-specific actionable message', async () => {
        setConfig({ provider: 'local', model: 'tinyllama' });
        mockService.isAvailable.mockResolvedValue(false);
        const local = await runTurn([{ role: 'user', content: 'q' }]);
        expect(local.success).toBe(false);
        expect(local.error).toMatch(/Ollama/);

        setConfig({ provider: 'google', model: 'gemini-2.5-flash' });
        mockService.isAvailable.mockResolvedValue(false);
        const cloud = await runTurn([{ role: 'user', content: 'q' }]);
        expect(cloud.error).toMatch(/google API key/);
        expect(mockService.complete).not.toHaveBeenCalled();
    });

    it('never throws — provider errors land in the result', async () => {
        setConfig({});
        mockService.isAvailable.mockResolvedValue(true);
        mockService.complete.mockRejectedValue(new Error('upstream 500'));

        const result = await runTurn([{ role: 'user', content: 'q' }]);
        expect(result.success).toBe(false);
        expect(result.error).toBe('upstream 500');
    });
});

describe('runTurnStream', () => {
    it('yields chunks and returns the accumulated content', async () => {
        setConfig({});
        mockService.isAvailable.mockResolvedValue(true);
        mockService.stream.mockImplementation(async function* () {
            yield 'Hello ';
            yield 'world.';
        });

        const gen = runTurnStream([{ role: 'user', content: 'q' }]);
        const chunks: string[] = [];
        let step = await gen.next();
        while (!step.done) {
            chunks.push(step.value);
            step = await gen.next();
        }

        expect(chunks).toEqual(['Hello ', 'world.']);
        expect(step.value).toEqual({ success: true, content: 'Hello world.' });
    });

    it('fails closed mid-stream without throwing', async () => {
        setConfig({});
        mockService.isAvailable.mockResolvedValue(true);
        mockService.stream.mockImplementation(async function* () {
            yield 'partial ';
            throw new Error('connection reset');
        });

        const gen = runTurnStream([{ role: 'user', content: 'q' }]);
        const chunks: string[] = [];
        let step = await gen.next();
        while (!step.done) {
            chunks.push(step.value);
            step = await gen.next();
        }

        expect(chunks).toEqual(['partial ']);
        expect(step.value.success).toBe(false);
        expect(step.value.error).toBe('connection reset');
    });

    it('keeps the partial and marks the turn stopped on abort', async () => {
        setConfig({});
        mockService.isAvailable.mockResolvedValue(true);
        mockService.stream.mockImplementation(async function* () {
            yield 'kept ';
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
        });

        const gen = runTurnStream([{ role: 'user', content: 'q' }]);
        const chunks: string[] = [];
        let step = await gen.next();
        while (!step.done) {
            chunks.push(step.value);
            step = await gen.next();
        }

        expect(chunks).toEqual(['kept ']);
        expect(step.value).toEqual({ success: true, content: 'kept ', stopped: true });
    });

    it('returns the unavailable message without calling stream', async () => {
        setConfig({ provider: 'anthropic', model: 'claude-haiku-4-5-20251001' });
        mockService.isAvailable.mockResolvedValue(false);

        const gen = runTurnStream([{ role: 'user', content: 'q' }]);
        const step = await gen.next();

        expect(step.done).toBe(true);
        expect((step.value as { error?: string }).error).toBe(
            unavailableMessage({ provider: 'anthropic', model: '', temperature: 0, maxTokens: 0 })
        );
        expect(mockService.stream).not.toHaveBeenCalled();
    });
});
