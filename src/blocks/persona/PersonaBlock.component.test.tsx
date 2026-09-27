// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaBlockView } from './PersonaBlock';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { useUIStore } from '@/core/stores';
import { createPersonaBlockData, DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { DataWire } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { PersonaTurnResult } from '@/core/services/persona.engine';

// Mock the persona engine — these tests cover the UI WIRING layer (the layer
// where the fake-handler bug lived), not the LLM round-trip itself.
vi.mock('@/core/services/persona.engine', () => ({
    streamPersonaTurn: vi.fn()
}));
import { streamPersonaTurn } from '@/core/services/persona.engine';

const PERSONA_ID = 'persona_analyst_test1';

function seedPersonaBlock() {
    const block: BlockInstance = {
        instance_id: PERSONA_ID,
        schema: {
            block_id: 'persona_analyst',
            display_name: 'Analyst',
            category: 'model'
        } as unknown as BlockInstance['schema'],
        status: 'connected',
        last_updated: null,
        data: createPersonaBlockData('analyst'),
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 400 },
        shellId: 'root'
    };
    useBlockStore.setState({ blocks: [block], activeShellId: 'root' });
}

function mockStream(chunks: string[], result: PersonaTurnResult) {
    vi.mocked(streamPersonaTurn).mockImplementation(async function* () {
        for (const c of chunks) yield c;
        return result;
    });
}

describe('PersonaBlockView — UI wiring', () => {
    beforeEach(() => {
        vi.mocked(streamPersonaTurn).mockReset();
        seedPersonaBlock();
        useWireStore.setState({ wires: [] } as never);
    });

    it('renders the persona with Think and message input', () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        expect(screen.getByText('Analyst')).toBeTruthy();
        expect(screen.getByTitle('Think')).toBeTruthy();
        expect(screen.getByPlaceholderText(/Ask Analyst/)).toBeTruthy();
    });

    it('Think streams the engine response into the conversation', async () => {
        mockStream(['Markets look ', 'stable today.'], {
            success: true,
            content: 'Markets look stable today.',
            sourceIds: [],
            sources: []
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        fireEvent.click(screen.getByTitle('Think'));

        expect(await screen.findByText(/Markets look stable today\./)).toBeTruthy();
        expect(vi.mocked(streamPersonaTurn)).toHaveBeenCalledWith(
            expect.objectContaining({ instanceId: PERSONA_ID, personaType: 'analyst', userMessage: undefined })
        );
    });

    it('sending a message shows it and streams the reply', async () => {
        mockStream(['Grounded ', 'answer.'], {
            success: true,
            content: 'Grounded answer.',
            sourceIds: [],
            sources: []
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        fireEvent.change(screen.getByPlaceholderText(/Ask Analyst/), {
            target: { value: 'What do you see?' }
        });
        fireEvent.keyDown(screen.getByPlaceholderText(/Ask Analyst/), { key: 'Enter' });

        expect(await screen.findByText('What do you see?')).toBeTruthy();
        expect(await screen.findByText(/Grounded answer\./)).toBeTruthy();
        expect(vi.mocked(streamPersonaTurn)).toHaveBeenCalledWith(
            expect.objectContaining({ userMessage: 'What do you see?' })
        );
    });

    it('engine failure surfaces a clear in-chat warning (no fake answer)', async () => {
        mockStream([], {
            success: false,
            sourceIds: [],
            sources: [],
            error: 'No LLM available — make sure Ollama is running (localhost:11434).'
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        fireEvent.click(screen.getByTitle('Think'));

        expect(await screen.findByText(/No LLM available/)).toBeTruthy();
        expect(screen.queryByText(/placeholder response/i)).toBeNull();
    });
});

describe('PersonaBlockView — provenance', () => {
    beforeEach(() => {
        seedPersonaBlock();
        useWireStore.setState({ wires: [] });
        useUIStore.setState({ highlightedBlockIds: [] });
        vi.mocked(streamPersonaTurn).mockReset();
    });

    it('names the blocks that fed the answer', async () => {
        mockStream(['Grounded.'], {
            success: true,
            content: 'Grounded.',
            sourceIds: ['src-fred'],
            sources: [{ id: 'src-fred', kind: 'wire', label: 'FRED Series' }]
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));

        expect(await screen.findByText('FRED Series')).toBeTruthy();
        expect(screen.getByText(/Grounded in/i)).toBeTruthy();
    });

    it('hovering a source chip lights that block on the canvas', async () => {
        mockStream(['ok'], {
            success: true,
            content: 'ok',
            sourceIds: ['src-fred'],
            sources: [{ id: 'src-fred', kind: 'wire', label: 'FRED Series' }]
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));

        const chip = await screen.findByText('FRED Series');
        fireEvent.mouseEnter(chip);
        expect(useUIStore.getState().highlightedBlockIds).toEqual(['src-fred']);

        fireEvent.mouseLeave(chip);
        expect(useUIStore.getState().highlightedBlockIds).toEqual([]);
    });

    it('shows recalled memory as a source, distinctly from live data', async () => {
        // Memory is a wired block now, so it names a thing on the canvas —
        // but it is styled apart because recollection is not live data.
        mockStream(['from memory'], {
            success: true,
            content: 'from memory',
            sourceIds: [],
            sources: [{ id: 'mem-block-1', kind: 'memory', label: 'Long-term memory' }]
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));

        expect(await screen.findByText('Long-term memory')).toBeTruthy();
        expect(screen.getByText(/recollection or another persona/i)).toBeTruthy();
    });

    it('an ungrounded answer claims no sources', async () => {
        mockStream(['general reasoning'], {
            success: true,
            content: 'general reasoning',
            sourceIds: [],
            sources: []
        });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));

        await screen.findByText(/general reasoning/);
        expect(screen.queryByText(/Grounded in/i)).toBeNull();
    });
});

describe('PersonaBlockView — answer rendering', () => {
    beforeEach(() => {
        seedPersonaBlock();
        useWireStore.setState({ wires: [] });
        vi.mocked(streamPersonaTurn).mockReset();
    });

    it('renders markdown instead of showing its syntax', async () => {
        const md = '## Outlook' + String.fromCharCode(10) + String.fromCharCode(10) +
            'Rates are **steady**.' + String.fromCharCode(10) + String.fromCharCode(10) +
            '- 10y near 4.2%' + String.fromCharCode(10) + '- CPI cooling';
        mockStream([md], { success: true, content: md, sourceIds: [], sources: [] });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));

        // The heading and emphasis become elements, not literal characters.
        expect(await screen.findByText('Outlook')).toBeTruthy();
        expect(screen.getByText('steady')).toBeTruthy();
        expect(screen.getByText('10y near 4.2%')).toBeTruthy();
        expect(screen.queryByText(/## Outlook/)).toBeNull();
        expect(screen.queryByText(/\*\*steady\*\*/)).toBeNull();
    });

    it('does not execute HTML embedded in an answer', async () => {
        // Answers can quote text that arrived from an external feed.
        const hostile = 'Look: <img src=x onerror="alert(1)">';
        mockStream([hostile], { success: true, content: hostile, sourceIds: [], sources: [] });
        const { container } = render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));

        await screen.findByText(/Look:/);
        expect(container.querySelector('img')).toBeNull();
    });

    it("leaves the user's own message as literal text", async () => {
        mockStream(['ok'], { success: true, content: 'ok', sourceIds: [], sources: [] });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        const input = screen.getByPlaceholderText(/Ask Analyst/);
        fireEvent.change(input, { target: { value: 'what about **this**?' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // A user typing asterisks meant asterisks.
        expect(await screen.findByText('what about **this**?')).toBeTruthy();
    });
});

describe('PersonaBlockView — empty states', () => {
    beforeEach(() => {
        seedPersonaBlock();
        useWireStore.setState({ wires: [] });
        vi.mocked(streamPersonaTurn).mockReset();
    });

    it('with no wires and no messages, invites wiring', () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        expect(screen.getByText(/Wire data blocks to me/i)).toBeTruthy();
        expect(screen.getByText(/right port to this block/i)).toBeTruthy();
    });

    it('with wires and no messages, does not ask to wire data blocks', () => {
        const wires: DataWire[] = [
            {
                id: 'w1',
                sourceBlockId: 'src-fred',
                targetBlockId: PERSONA_ID,
                wireType: 'push',
                filters: { ...DEFAULT_WIRE_FILTERS },
                status: 'active',
                shellId: 'root'
            },
            {
                id: 'w2',
                sourceBlockId: 'src-news',
                targetBlockId: PERSONA_ID,
                wireType: 'push',
                filters: { ...DEFAULT_WIRE_FILTERS },
                status: 'active',
                shellId: 'root'
            }
        ];
        useWireStore.setState({ wires });

        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        expect(screen.queryByText(/Wire data blocks to me/i)).toBeNull();
        expect(screen.queryByText(/right port to this block/i)).toBeNull();
        expect(screen.getByText(/2 sources connected/i)).toBeTruthy();
        expect(screen.getByText(/Think, or ask a question/i)).toBeTruthy();
    });
});
