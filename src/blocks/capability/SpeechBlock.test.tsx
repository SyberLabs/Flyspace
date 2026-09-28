// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpeechBlockView } from './SpeechBlock';
import { CapabilityBlockView } from './CapabilityBlock';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { getBlockView } from '@/core/registry/ViewRegistry';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { clearCapabilities, ensureSpeechCapabilities } from '@/core/capabilities/registry';
import { setSpeechEngine, type SpeechEngine } from '@/core/capabilities/speech';

function engine(options?: { speak?: boolean; listen?: boolean; transcript?: string }): SpeechEngine & { spoken: string[] } {
    const spoken: string[] = [];
    return {
        spoken,
        supported: () => ({
            speak: options?.speak !== false,
            listen: options?.listen !== false
        }),
        speak: async (text: string) => {
            spoken.push(text);
        },
        listen: async () => options?.transcript ?? 'from the mic'
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

describe('SpeechBlockView', () => {
    it('is the canvas view for both speech blocks and does not run on mount', () => {
        expect(getBlockView('cap_speech_speak')).toBe(SpeechBlockView);
        expect(getBlockView('cap_speech_listen')).toBe(SpeechBlockView);
        expect(getBlockView('cap_listposts')).toBe(CapabilityBlockView);

        const fake = engine();
        setSpeechEngine(fake);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_speak')!, { x: 0, y: 0 });
        render(<SpeechBlockView instanceId={instanceId} />);
        expect(fake.spoken).toEqual([]);
        expect((screen.getByRole('button', { name: 'Speak' }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('speaks the field and shows the spoken line', async () => {
        const fake = engine();
        setSpeechEngine(fake);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_speak')!, { x: 0, y: 0 });
        render(<SpeechBlockView instanceId={instanceId} />);
        fireEvent.change(screen.getByLabelText('Text to speak'), { target: { value: 'hello board' } });
        fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
        expect(await screen.findByText('Spoke: hello board')).toBeTruthy();
        expect(fake.spoken).toEqual(['hello board']);
    });

    it('speaks wired text when the field is empty', async () => {
        const fake = engine();
        setSpeechEngine(fake);
        const note = useBlockStore.getState().addBlock(blockRegistry.get('text_note')!, { x: 0, y: 0 });
        const speak = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_speak')!, { x: 0, y: 0 });
        useBlockStore.getState().updateData(note, { content: 'wired aloud' });
        useWireStore.getState().addWire(note, speak);
        render(<SpeechBlockView instanceId={speak} />);
        fireEvent.click(screen.getByRole('button', { name: 'Speak' }));
        expect(await screen.findByText('Spoke: wired aloud')).toBeTruthy();
        expect(fake.spoken).toEqual(['wired aloud']);
    });

    it('listens and shows the transcript', async () => {
        const fake = engine({ transcript: 'market closed' });
        setSpeechEngine(fake);
        const instanceId = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_listen')!, { x: 0, y: 0 });
        render(<SpeechBlockView instanceId={instanceId} />);
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        expect(await screen.findByText('market closed')).toBeTruthy();
    });

    it('disables the control when the browser has no speech engine', () => {
        setSpeechEngine(engine({ speak: false, listen: false }));
        const speakId = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_speak')!, { x: 0, y: 0 });
        useBlockStore.getState().updateStatus(speakId, 'error', 'Speech synthesis failed (synthesis-failed)');
        const { unmount } = render(<SpeechBlockView instanceId={speakId} />);
        expect(screen.getByText('This browser has no speech synthesis.')).toBeTruthy();
        expect(screen.queryByText('Speech synthesis failed (synthesis-failed)')).toBeNull();
        expect((screen.getByRole('button', { name: 'Speak' }) as HTMLButtonElement).disabled).toBe(true);
        unmount();

        const listenId = useBlockStore.getState().addBlock(blockRegistry.get('cap_speech_listen')!, { x: 0, y: 0 });
        render(<SpeechBlockView instanceId={listenId} />);
        expect(screen.getByText('This browser has no speech recognition.')).toBeTruthy();
        expect((screen.getByRole('button', { name: 'Listen' }) as HTMLButtonElement).disabled).toBe(true);
    });
});
