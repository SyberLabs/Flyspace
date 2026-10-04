import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { blockRegistry } from '../registry/BlockRegistry';
import { useBlockStore } from '../stores/blockStore';
import { useWireStore } from '../stores/wireStore';
import { clearCapabilities, ensureSpeechCapabilities, runInstalledCapability } from './registry';
import { resolveWiredInputs } from './wireInputs';
import { setSpeechEngine, type SpeechEngine } from './speech';

function fakeEngine(): SpeechEngine & { spoken: string[] } {
    const spoken: string[] = [];
    return {
        spoken,
        supported: () => ({ speak: true, listen: true }),
        speak: async (text: string) => {
            spoken.push(text);
        },
        listen: async () => 'heard'
    };
}

beforeEach(() => {
    clearCapabilities();
    ensureSpeechCapabilities();
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

afterEach(() => {
    setSpeechEngine(null);
    clearCapabilities();
});

function place(blockId: string): string {
    const schema = blockRegistry.get(blockId);
    if (!schema) throw new Error(`missing ${blockId}`);
    return useBlockStore.getState().addBlock(schema, { x: 0, y: 0 });
}

describe('resolveWiredInputs', () => {
    it('reads the latest non-warning assistant message into the string sink', () => {
        const persona = place('persona_analyst');
        const speak = place('cap_speech_speak');
        useBlockStore.getState().updateData(persona, {
            messages: [
                { role: 'assistant', content: 'earlier' },
                { role: 'assistant', content: '⚠️ model failed' },
                { role: 'user', content: 'ignore me' }
            ]
        });
        useWireStore.getState().addWire(persona, speak);
        expect(resolveWiredInputs(speak)).toEqual({ text: 'earlier' });
    });

    it('reads text-block content and joined item titles', () => {
        const note = place('text_note');
        const speak = place('cap_speech_speak');
        useBlockStore.getState().updateData(note, { content: '  from the note  ' });
        useWireStore.getState().addWire(note, speak);
        expect(resolveWiredInputs(speak).text).toBe('  from the note  ');

        const feed = place('polymarket_live_odds');
        const second = place('cap_speech_speak');
        useBlockStore.getState().updateData(feed, {
            items: [{ title: 'Alpha' }, { title: 'Beta' }, { id: 'skip' }]
        });
        useWireStore.getState().addWire(feed, second);
        expect(resolveWiredInputs(second).text).toBe('Alpha\nBeta');
    });

    it('prefers typed fields that match input names', () => {
        const source = place('text_note');
        const speak = place('cap_speech_speak');
        useBlockStore.getState().updateData(source, {
            typed: { value: { text: 'from typed', ignored: 1 } },
            content: 'from content'
        });
        useWireStore.getState().addWire(source, speak);
        expect(resolveWiredInputs(speak)).toEqual({ text: 'from typed' });
    });

    it('lets block params and the explicit run input override the wire', async () => {
        const engine = fakeEngine();
        setSpeechEngine(engine);
        const note = place('text_note');
        const speak = place('cap_speech_speak');
        useBlockStore.getState().updateData(note, { content: 'wired' });
        useWireStore.getState().addWire(note, speak);
        useBlockStore.getState().setParams(speak, { text: 'from params' });

        const fromParams = await runInstalledCapability(speak);
        expect(fromParams.ok).toBe(true);
        expect(engine.spoken).toEqual(['from params']);

        const fromRun = await runInstalledCapability(speak, { text: 'from run' });
        expect(fromRun.ok).toBe(true);
        expect(engine.spoken).toEqual(['from params', 'from run']);
        const stored = useBlockStore.getState().getBlock(speak)?.data as { items?: Array<{ title: string }> };
        expect(stored.items?.[0]?.title).toBe('from run');
    });

    it('does not pour prose into Listen\'s optional language', () => {
        const note = place('text_note');
        const listen = place('cap_speech_listen');
        useBlockStore.getState().updateData(note, { content: 'en-GB' });
        useWireStore.getState().addWire(note, listen);
        expect(resolveWiredInputs(listen)).toEqual({});
    });

    it('matches typed fields by own property only, never through a prototype', () => {
        const source = place('text_note');
        const speak = place('cap_speech_speak');
        useBlockStore.getState().updateData(source, {
            typed: { value: Object.create({ text: 'inherited' }) as Record<string, unknown> },
            content: 'from content'
        });
        useWireStore.getState().addWire(source, speak);
        expect(resolveWiredInputs(speak)).toEqual({ text: 'from content' });
    });
});
