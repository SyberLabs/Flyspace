import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// localStorage is polyfilled in vitest.setup.ts.
import {
    buildPersonaSystemPrompt,
    preparePersonaTurn,
    streamPersonaTurn
} from './persona.engine';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { useMindStore } from '@/core/stores/mindStore';
import { createPersonaBlockData } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import { runTurnStream } from '@/core/cognition';

vi.mock('@/core/cognition', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/cognition')>();
    return { ...actual, runTurnStream: vi.fn(actual.runTurnStream) };
});

function makeBlock(id: string, blockId: string, data: unknown): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: blockId, display_name: blockId, category: 'truth' } as unknown as BlockInstance['schema'],
        status: 'connected',
        last_updated: Date.now(),
        data,
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 240 },
        shellId: 'root'
    };
}

describe('buildPersonaSystemPrompt', () => {
    it('includes the persona name and focus', () => {
        const p = buildPersonaSystemPrompt('analyst');
        expect(p).toContain('Analyst');
        expect(p).toContain('The Citadel');
        expect(p).toMatch(/wired/i);
    });

    it('honors a custom name', () => {
        expect(buildPersonaSystemPrompt('strategist', 'War Room')).toContain('War Room');
    });
});

describe('preparePersonaTurn — message assembly', () => {
    const personaId = 'persona_analyst_1';

    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });

    it('injects wired data context into the user message', () => {
        // A news data block wired into the persona.
        const newsData = { articles: [{ title: 'Rates held steady', source: 'Reuters', publishedAt: new Date().toISOString() }] };
        useBlockStore.setState({
            blocks: [
                makeBlock('news_1', 'newsapi_feed', newsData),
                makeBlock(personaId, 'persona_analyst', createPersonaBlockData('analyst'))
            ],
           
            activeShellId: 'root'
        });
        useWireStore.getState().addWire('news_1', personaId);

        const { messages, hasContext, sourceIds } = preparePersonaTurn({
            instanceId: personaId,
            personaType: 'analyst',
            userMessage: 'What stands out?'
        });

        expect(hasContext).toBe(true);
        expect(sourceIds).toContain('news_1');
        // system + user (no history)
        expect(messages[0].role).toBe('system');
        const userMsg = messages[messages.length - 1];
        expect(userMsg.role).toBe('user');
        expect(userMsg.content).toContain('Wired Data Context');
        expect(userMsg.content).toContain('Rates held steady'); // the actual data
        expect(userMsg.content).toContain('What stands out?');   // the task
    });

    it('notes when no data is wired in', () => {
        useBlockStore.setState({
            blocks: [makeBlock(personaId, 'persona_analyst', createPersonaBlockData('analyst'))],
           
            activeShellId: 'root'
        });

        const { messages, hasContext } = preparePersonaTurn({
            instanceId: personaId,
            personaType: 'analyst',
            userMessage: 'Hello'
        });

        expect(hasContext).toBe(false);
        expect(messages[messages.length - 1].content).toMatch(/No active data sources connected/i);
    });

    it('says the wired sources are empty when every wired source carried no data', () => {
        useBlockStore.setState({
            blocks: [
                makeBlock('feed_1', 'hackernews_feed', { items: [] }),
                makeBlock(personaId, 'persona_analyst', createPersonaBlockData('analyst'))
            ],
            activeShellId: 'root'
        });
        useWireStore.getState().addWire('feed_1', personaId);

        const { messages, hasContext, sourceIds } = preparePersonaTurn({
            instanceId: personaId,
            personaType: 'analyst',
            userMessage: 'Hello'
        });

        expect(hasContext).toBe(false);
        expect(sourceIds).toEqual([]);
        const prompt = messages[messages.length - 1].content;
        expect(prompt).toMatch(/Connected sources have no data available yet/i);
        expect(prompt).not.toMatch(/No active data sources connected/i);
    });

    it('uses the default Think task when no user message is given', () => {
        useBlockStore.setState({
            blocks: [makeBlock(personaId, 'persona_analyst', createPersonaBlockData('analyst'))],
           
            activeShellId: 'root'
        });

        const { messages } = preparePersonaTurn({ instanceId: personaId, personaType: 'analyst' });
        expect(messages[messages.length - 1].content).toMatch(/Analyze the data wired into you/i);
    });

    it('includes recent history, capped, in order', () => {
        useBlockStore.setState({
            blocks: [makeBlock(personaId, 'persona_analyst', createPersonaBlockData('analyst'))],
           
            activeShellId: 'root'
        });

        const history = Array.from({ length: 15 }, (_, i) => ({
            id: `m${i}`,
            role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
            content: `msg ${i}`,
            timestamp: i
        }));

        const { messages } = preparePersonaTurn({
            instanceId: personaId,
            personaType: 'analyst',
            history,
            userMessage: 'next'
        });

        // system + 10 history + 1 user
        expect(messages.length).toBe(12);
        expect(messages[1].content).toBe('msg 5'); // last 10 → starts at index 5
    });
});

describe('streamPersonaTurn — fails closed', () => {
    beforeEach(() => {
        useBlockStore.setState({
            blocks: [makeBlock('p', 'persona_analyst', createPersonaBlockData('analyst'))],
           
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [] } as never);
        // Force the local provider; no Ollama running in tests → isAvailable false.
        useMindStore.setState({
            llmConfig: { provider: 'local', model: 'tinyllama', temperature: 0.7, maxTokens: 1024 }
        } as never);
    });

    it('returns a clear error (no throw) when no provider is available', async () => {
        const gen = streamPersonaTurn({ instanceId: 'p', personaType: 'analyst', userMessage: 'hi' });
        const r = await gen.next();
        // No provider → generator returns immediately with a failure result.
        expect(r.done).toBe(true);
        const result = r.value as { success: boolean; error?: string };
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Ollama|not available/i);
    });
});

describe('streamPersonaTurn — onPrepared before first token', () => {
    const originalStream = vi.mocked(runTurnStream).getMockImplementation();

    beforeEach(() => {
        useBlockStore.setState({
            blocks: [
                makeBlock('news_1', 'newsapi_feed', {
                    articles: [{ title: 'Rates held steady', source: 'Reuters', publishedAt: new Date().toISOString() }]
                }),
                makeBlock('p', 'persona_analyst', createPersonaBlockData('analyst'))
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [] } as never);
        useWireStore.getState().addWire('news_1', 'p');
    });

    afterEach(() => {
        if (originalStream) vi.mocked(runTurnStream).mockImplementation(originalStream);
        else vi.mocked(runTurnStream).mockReset();
    });

    it('fires onPrepared before the first yielded token, with the turn\'s sources', async () => {
        // The pulse must start before any token so the user sees the read,
        // and it must name the same sources the answer will cite.
        const order: string[] = [];
        const onPrepared = vi.fn((sources: Array<{ id: string }>) => {
            order.push('prepared');
            expect(sources.some(s => s.id === 'news_1')).toBe(true);
        });

        vi.mocked(runTurnStream).mockImplementation(async function* () {
            order.push('token');
            yield 'hello';
            return { success: true, content: 'hello' };
        });

        const gen = streamPersonaTurn({
            instanceId: 'p',
            personaType: 'analyst',
            onPrepared
        });
        const first = await gen.next();
        expect(first.done).toBe(false);
        expect(first.value).toBe('hello');
        expect(onPrepared).toHaveBeenCalledTimes(1);
        expect(order).toEqual(['prepared', 'token']);

        const last = await gen.next();
        expect(last.done).toBe(true);
        const result = last.value as { sources: Array<{ id: string }> };
        expect(onPrepared.mock.calls[0][0]).toEqual(result.sources);
    });
});
