// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PersonaBlockView } from './PersonaBlock';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { PREVIEW_AI_OFF_MESSAGE } from '@/core/services/personaTurn.service';
import { createPersonaBlockData, DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { DataWire, PersonaBlockData, PersonaChatMessage } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';

const PERSONA_ID = 'persona_analyst_test1';

function personaBlock(id: string, messages: PersonaChatMessage[] = []): BlockInstance {
    return {
        instance_id: id,
        schema: {
            block_id: 'persona_analyst',
            display_name: 'Analyst',
            category: 'model'
        } as unknown as BlockInstance['schema'],
        status: 'connected',
        last_updated: null,
        data: { ...createPersonaBlockData('analyst'), messages },
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 400 },
        shellId: 'root'
    };
}

function seed(messages: PersonaChatMessage[] = []) {
    useBlockStore.setState({ blocks: [personaBlock(PERSONA_ID, messages)], activeShellId: 'root' });
}

function wire(id: string, from: string, to = PERSONA_ID): DataWire {
    return {
        id,
        sourceBlockId: from,
        targetBlockId: to,
        wireType: 'push',
        filters: { ...DEFAULT_WIRE_FILTERS },
        status: 'active',
        shellId: 'root'
    };
}

const messagesOf = (id = PERSONA_ID) => (useBlockStore.getState().getBlock(id)?.data as PersonaBlockData).messages;

beforeEach(() => {
    seed();
    useWireStore.setState({ wires: [] });
});

describe('PersonaBlockView — UI wiring', () => {
    it('renders the persona with Think and message input', () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        expect(screen.getByText('Analyst')).toBeTruthy();
        expect(screen.getByTitle('Think')).toBeTruthy();
        expect(screen.getByPlaceholderText(/Ask Analyst/)).toBeTruthy();
    });

    it('Think says in the conversation that AI answers are off', async () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        fireEvent.click(screen.getByTitle('Think'));

        expect(await screen.findByText(new RegExp(PREVIEW_AI_OFF_MESSAGE))).toBeTruthy();
        expect(messagesOf().map(message => message.role)).toEqual(['assistant']);
    });

    it('sending a message shows it, clears the box, and says AI answers are off', async () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        const input = screen.getByPlaceholderText(/Ask Analyst/) as HTMLInputElement;

        fireEvent.change(input, { target: { value: 'What do you see?' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(await screen.findByText('What do you see?')).toBeTruthy();
        expect(screen.getByText(new RegExp(PREVIEW_AI_OFF_MESSAGE))).toBeTruthy();
        expect(input.value).toBe('');
    });

    it('sends nothing for a blank message', () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        const input = screen.getByPlaceholderText(/Ask Analyst/);

        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(messagesOf()).toEqual([]);
    });

    it('Regenerate replaces the last answer instead of stacking another', async () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle('Think'));
        const first = messagesOf()[0].id;

        fireEvent.click(await screen.findByTitle('Regenerate this answer'));

        expect(messagesOf()).toHaveLength(1);
        expect(messagesOf()[0].id).not.toBe(first);
    });

    it('offers the chain only with a persona upstream, and runs upstream first', () => {
        useBlockStore.setState({ blocks: [personaBlock('upstream'), personaBlock(PERSONA_ID)], activeShellId: 'root' });
        const lone = render(<PersonaBlockView instanceId="upstream" />);
        expect(screen.queryByTitle(/Run chain/)).toBeNull();
        lone.unmount();

        useWireStore.setState({ wires: [wire('w1', 'upstream')] });
        render(<PersonaBlockView instanceId={PERSONA_ID} />);
        fireEvent.click(screen.getByTitle(/Run chain/));

        expect(messagesOf('upstream')).toHaveLength(1);
        expect(messagesOf()).toHaveLength(1);
    });
});

describe('PersonaBlockView — message rendering', () => {
    const message = (role: PersonaChatMessage['role'], content: string): PersonaChatMessage => ({
        id: `m-${content}`, role, content, timestamp: 1
    });

    it('does not execute HTML embedded in a message', () => {
        seed([message('assistant', 'Look: <img src=x onerror="alert(1)">')]);
        const { container } = render(<PersonaBlockView instanceId={PERSONA_ID} />);

        expect(screen.getByText(/Look:/)).toBeTruthy();
        expect(container.querySelector('img')).toBeNull();
    });

    it("leaves the user's own message as literal text", async () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        const input = screen.getByPlaceholderText(/Ask Analyst/);
        fireEvent.change(input, { target: { value: 'what about **this**?' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        // A user typing asterisks meant asterisks.
        expect(await screen.findByText('what about **this**?')).toBeTruthy();
    });

    it('offers Regenerate only on the last answer', () => {
        seed([message('assistant', 'first'), message('user', 'again'), message('assistant', 'second')]);
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        expect(screen.getAllByTitle('Regenerate this answer')).toHaveLength(1);
    });
});

describe('PersonaBlockView — empty states', () => {
    it('with no wires and no messages, invites wiring', () => {
        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        expect(screen.getByText(/Wire data blocks to me/i)).toBeTruthy();
        expect(screen.getByText(/Drag from block edge/i)).toBeTruthy();
    });

    it('with wires and no messages, counts them and says AI answers are off', () => {
        useWireStore.setState({ wires: [wire('w1', 'src-fred'), wire('w2', 'src-news')] });

        render(<PersonaBlockView instanceId={PERSONA_ID} />);

        expect(screen.queryByText(/Wire data blocks to me/i)).toBeNull();
        expect(screen.queryByText(/Drag from block edge/i)).toBeNull();
        expect(screen.getByText(/2 sources connected/i)).toBeTruthy();
        expect(screen.getByText(/AI answers are off in the public preview/i)).toBeTruthy();
        expect(screen.queryByText(/Think, or ask a question/i)).toBeNull();
    });
});
