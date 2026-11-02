import { beforeEach, describe, expect, it } from 'vitest';
import { PREVIEW_AI_OFF_MESSAGE, regeneratePersonaTurn, runPersonaTurn } from './personaTurn.service';
import { useBlockStore } from '@/core/stores/blockStore';
import { createPersonaBlockData, type PersonaBlockData, type PersonaChatMessage } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';

const ID = 'persona-1';
const WARNING = `⚠️ ${PREVIEW_AI_OFF_MESSAGE}`;

function seed(messages: PersonaChatMessage[] = []) {
    useBlockStore.setState({
        blocks: [{
            instance_id: ID,
            schema: { block_id: 'persona_analyst', display_name: 'Analyst', category: 'model' },
            status: 'connected',
            last_updated: null,
            data: { ...createPersonaBlockData('analyst'), messages, isThinking: true },
            position: { x: 0, y: 0 },
            dimensions: { width: 320, height: 400 },
            shellId: 'root'
        } as unknown as BlockInstance],
        activeShellId: 'root'
    });
}

const data = () => useBlockStore.getState().getBlock(ID)?.data as PersonaBlockData;
const said = () => data().messages.map(message => [message.role, message.content]);

beforeEach(() => seed());

describe('runPersonaTurn', () => {
    it('commits the question, then the warning', () => {
        runPersonaTurn(ID, 'What do you see?');
        expect(said()).toEqual([['user', 'What do you see?'], ['assistant', WARNING]]);
        expect(data().isThinking).toBe(false);
    });

    it('commits only the warning for a Think with no question', () => {
        runPersonaTurn(ID);
        expect(said()).toEqual([['assistant', WARNING]]);
    });

    it('claims no sources for its answer', () => {
        runPersonaTurn(ID);
        expect(data().messages[0]).toMatchObject({ sourcedFrom: [], sources: [] });
    });

    it('does nothing for a missing block', () => {
        runPersonaTurn('nobody', 'hello');
        expect(said()).toEqual([]);
        expect(useBlockStore.getState().getBlock('nobody')).toBeUndefined();
    });
});

describe('regeneratePersonaTurn', () => {
    it('drops the last answer, keeps the question, and commits the warning again', () => {
        seed([
            { id: 'q', role: 'user', content: 'Why?', timestamp: 1 },
            { id: 'a', role: 'assistant', content: 'An old answer', timestamp: 2 }
        ]);
        regeneratePersonaTurn(ID);
        expect(said()).toEqual([['user', 'Why?'], ['assistant', WARNING]]);
        expect(data().messages.map(message => message.id)).not.toContain('a');
    });

    it('does nothing when there is no answer to replace', () => {
        seed([{ id: 'q', role: 'user', content: 'Why?', timestamp: 1 }]);
        regeneratePersonaTurn(ID);
        expect(said()).toEqual([['user', 'Why?']]);
    });

    it('does nothing for a missing block', () => {
        regeneratePersonaTurn('nobody');
        expect(said()).toEqual([]);
        expect(useBlockStore.getState().getBlock('nobody')).toBeUndefined();
    });
});
