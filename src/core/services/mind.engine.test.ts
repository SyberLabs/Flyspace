// ============================================
// MIND ENGINE — the Mind panel's think path.
//
// Persona turns do not go through here (those are personaTurn.service).
// This still has to fail closed, never leave status stuck on processing,
// and write the answer into observations rather than a hidden prompt path.
// ============================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MindEngine } from './mind.engine';
import { useMindStore } from '@/core/stores/mindStore';
import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import { createInitialMindState } from '@/core/schemas/mind.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { DataWire } from '@/core/schemas/wire.schema';
import { runTurn, runTurnStream } from '@/core/cognition';

vi.mock('@/core/cognition', () => ({
    runTurn: vi.fn(),
    runTurnStream: vi.fn()
}));

function seedBlock() {
    const block: BlockInstance = {
        instance_id: 'b1',
        schema: { block_id: 'hackernews_feed', display_name: 'Hacker News', category: 'pulse' },
        status: 'connected',
        last_updated: Date.now(),
        data: { items: [{ title: 'Story' }] },
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId: 'root'
    } as unknown as BlockInstance;
    useBlockStore.setState({ blocks: [block], activeShellId: 'root' });
    // Think only sees wired or pinned blocks; pinning is the explicit way in.
    useMindStore.getState().pinBlock('b1', 'hackernews_feed', block.data);
}

beforeEach(() => {
    useMindStore.setState(createInitialMindState());
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
    vi.mocked(runTurn).mockReset();
    vi.mocked(runTurnStream).mockReset();
});

describe('MindEngine.think', () => {
    it('refuses to think on an empty canvas', async () => {
        const engine = new MindEngine();
        const result = await engine.think();
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/wired or pinned/);
        expect(runTurn).not.toHaveBeenCalled();
        expect(useMindStore.getState().status).toBe('ready');
    });

    it('fails closed when the LLM turn fails, and is not left processing', async () => {
        seedBlock();
        vi.mocked(runTurn).mockResolvedValue({ success: false, content: '', error: 'Ollama is not running' });

        const engine = new MindEngine();
        const result = await engine.think();

        expect(result).toEqual({ success: false, error: 'Ollama is not running' });
        expect(useMindStore.getState().status).toBe('error');

        vi.mocked(runTurn).mockResolvedValue({ success: true, content: 'ok', tokensUsed: 1 });
        const second = await engine.think();
        expect(second.success).toBe(true);
    });

    it('writes a successful answer into the observations pool', async () => {
        seedBlock();
        vi.mocked(runTurn).mockResolvedValue({
            success: true,
            content: 'Rates look steady.',
            tokensUsed: 12
        });

        const engine = new MindEngine();
        const result = await engine.think('What do you see?');

        expect(result.success).toBe(true);
        expect(result.response).toBe('Rates look steady.');
        const observations = useMindStore.getState().contextPools.find(p => p.id === 'observations');
        expect(observations?.entries.some(e => e.content === 'Rates look steady.')).toBe(true);
        expect(useMindStore.getState().status).toBe('ready');
    });

    it('rejects a second think while one is in flight', async () => {
        seedBlock();
        let release!: (value: { success: true; content: string }) => void;
        vi.mocked(runTurn).mockImplementation(
            () => new Promise(resolve => { release = resolve; })
        );

        const engine = new MindEngine();
        const first = engine.think();
        const second = await engine.think();
        expect(second).toEqual({ success: false, error: 'Already processing' });

        release({ success: true, content: 'done' });
        await first;
    });
});

// ---- Think's context is what the canvas shows ------------------------------

function scopedBlock(id: string, name: string, shellId: string): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'hackernews_feed', display_name: name, category: 'pulse' },
        status: 'connected',
        last_updated: Date.now(),
        data: { items: [{ title: 'Story' }] },
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId
    } as unknown as BlockInstance;
}

function scopedWire(id: string, from: string, to: string, shellId: string): DataWire {
    return {
        id,
        sourceBlockId: from,
        targetBlockId: to,
        wireType: 'push',
        status: 'active',
        filters: { autoRefresh: true },
        shellId
    } as unknown as DataWire;
}

/** Everything the model was sent for the last Think. */
function sentPrompt(): string {
    const messages = vi.mocked(runTurn).mock.calls[0][0];
    return messages.map(m => m.content).join('\n');
}

describe('MindEngine.think — context is what the canvas shows', () => {
    beforeEach(() => {
        vi.mocked(runTurn).mockResolvedValue({ success: true, content: 'ok', tokensUsed: 1 });
    });

    it('excludes a wired block in another shell and an unwired block in the active shell', async () => {
        useBlockStore.setState({
            blocks: [
                scopedBlock('src', 'WiredSource', 'root'),
                scopedBlock('sink', 'WiredSink', 'root'),
                scopedBlock('loose', 'UnwiredLoose', 'root'),
                scopedBlock('o-src', 'OtherShellSource', 'other'),
                scopedBlock('o-sink', 'OtherShellSink', 'other')
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [scopedWire('w1', 'src', 'sink', 'root'), scopedWire('w2', 'o-src', 'o-sink', 'other')]
        });

        const result = await new MindEngine().think();
        expect(result.success).toBe(true);

        const prompt = sentPrompt();
        expect(prompt).toContain('WiredSource');
        expect(prompt).toContain('WiredSink');
        expect(prompt).not.toContain('UnwiredLoose');
        expect(prompt).not.toContain('OtherShellSource');
        expect(prompt).not.toContain('OtherShellSink');

        const obs = useMindStore.getState().contextPools.find(p => p.id === 'observations');
        expect(obs?.entries.at(-1)?.metadata?.blocksAnalyzed).toBe(2);
    });

    it('ignores wires that are not active', async () => {
        useBlockStore.setState({
            blocks: [scopedBlock('a', 'StaleA', 'root'), scopedBlock('b', 'StaleB', 'root')],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [{ ...scopedWire('w1', 'a', 'b', 'root'), status: 'stale' }]
        });

        const result = await new MindEngine().think();
        expect(result.success).toBe(false);
        expect(runTurn).not.toHaveBeenCalled();
    });

    it('includes an explicitly pinned block in the active shell, but not a pin from another shell', async () => {
        useBlockStore.setState({
            blocks: [
                scopedBlock('pin', 'PinnedHere', 'root'),
                scopedBlock('o-pin', 'PinnedElsewhere', 'other')
            ],
            activeShellId: 'root'
        });
        useMindStore.getState().pinBlock('pin', 'hackernews_feed', { items: [] });
        useMindStore.getState().pinBlock('o-pin', 'hackernews_feed', { items: [] });

        await new MindEngine().think();

        const prompt = sentPrompt();
        expect(prompt).toContain('PinnedHere');
        expect(prompt).not.toContain('PinnedElsewhere');
    });

    it('does not carry background awareness aggregated across shells', async () => {
        useBlockStore.setState({
            blocks: [scopedBlock('src', 'WiredSource', 'root'), scopedBlock('sink', 'WiredSink', 'root')],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [scopedWire('w1', 'src', 'sink', 'root')] });
        // useMindShellSync writes this from ALL blocks of a type, any shell.
        useMindStore.getState().updateAwareness('hackernews_feed', 'CROSS-SHELL AWARENESS SUMMARY');

        await new MindEngine().think();

        expect(sentPrompt()).not.toContain('CROSS-SHELL AWARENESS SUMMARY');
    });

    it('thinkStream applies the same scope', async () => {
        useBlockStore.setState({
            blocks: [
                scopedBlock('src', 'WiredSource', 'root'),
                scopedBlock('sink', 'WiredSink', 'root'),
                scopedBlock('loose', 'UnwiredLoose', 'root')
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [scopedWire('w1', 'src', 'sink', 'root')] });
        vi.mocked(runTurnStream).mockImplementation((async function* () {
            yield 'ok';
            return { success: true, content: 'ok' };
        }) as unknown as typeof runTurnStream);

        const stream = new MindEngine().thinkStream();
        let step = await stream.next();
        while (!step.done) step = await stream.next();

        const messages = vi.mocked(runTurnStream).mock.calls[0][0];
        const prompt = messages.map(m => m.content).join('\n');
        expect(prompt).toContain('WiredSource');
        expect(prompt).not.toContain('UnwiredLoose');
    });

    it('thinkStream refuses when nothing is wired or pinned', async () => {
        useBlockStore.setState({
            blocks: [scopedBlock('loose', 'UnwiredLoose', 'root')],
            activeShellId: 'root'
        });
        const step = await new MindEngine().thinkStream().next();
        expect(step.done).toBe(true);
        expect(step.value).toMatchObject({ success: false });
        expect(runTurnStream).not.toHaveBeenCalled();
    });
});
