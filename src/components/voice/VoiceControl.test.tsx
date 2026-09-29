// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VoiceControl } from './VoiceControl';
import { useBlockStore, useUIStore } from '@/core/stores';
import type { DictationSession, Voice } from '@/core/interaction/pushToTalk';

class ScriptedDictation implements DictationSession {
    constructor(private readonly text: string) {}
    start() {}
    stop() { return Promise.resolve(this.text); }
    abort() {}
}

function voice(): Voice & { spoken: string[] } {
    return {
        spoken: [],
        speak(text: string) { this.spoken.push(text); },
        cancel() {}
    };
}

describe('VoiceControl', () => {
    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useUIStore.setState({ commandPaletteOpen: false });
    });

    it('holds to talk, runs the canvas command, and speaks the reply', async () => {
        const spoken = voice();
        render(
            <VoiceControl
                listen={() => new ScriptedDictation('create a researcher')}
                voice={spoken}
            />
        );
        expect(screen.queryByLabelText('Spoken command')).toBeNull();
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(useBlockStore.getState().blocks.some(block => block.schema.block_id === 'persona_researcher')).toBe(true);
        expect(spoken.spoken).toEqual(['Added Researcher.']);
    });

    it('holds the space bar outside a text field', async () => {
        render(<VoiceControl listen={() => new ScriptedDictation('create an analyst')} voice={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.keyUp(window, { code: 'Space', key: ' ' });
        expect(await screen.findByText('Added Analyst.')).toBeTruthy();
    });

    it('does not steal space while typing', async () => {
        render(
            <div>
                <input aria-label="Note" />
                <VoiceControl listen={() => new ScriptedDictation('create an analyst')} voice={voice()} />
            </div>
        );
        const field = screen.getByLabelText('Note');
        field.focus();
        fireEvent.keyDown(field, { code: 'Space', key: ' ' });
        fireEvent.keyUp(field, { code: 'Space', key: ' ' });
        expect(screen.queryByText('Added Analyst.')).toBeNull();
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('starts listening even if pointer capture is unavailable', () => {
        render(<VoiceControl listen={() => new ScriptedDictation('create a researcher')} voice={voice()} />);
        const button = screen.getByRole('button', { name: 'Hold to talk' });
        button.setPointerCapture = () => {
            throw new Error('No active pointer with the given id is found.');
        };
        fireEvent.pointerDown(button);
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('status').textContent).toBe('Listening');
    });

    it('does not steal space from another button', () => {
        render(
            <div>
                <button type="button">Browse shells</button>
                <VoiceControl listen={() => new ScriptedDictation('create an analyst')} voice={voice()} />
            </div>
        );
        const browse = screen.getByRole('button', { name: 'Browse shells' });
        browse.focus();
        fireEvent.keyDown(browse, { code: 'Space', key: ' ' });
        fireEvent.keyUp(browse, { code: 'Space', key: ' ' });
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('leaves space to the command palette', () => {
        useUIStore.setState({ commandPaletteOpen: true });
        render(<VoiceControl listen={() => new ScriptedDictation('create an analyst')} voice={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.keyUp(window, { code: 'Space', key: ' ' });
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('applies one command when the pointer releases twice', async () => {
        const spoken = voice();
        render(<VoiceControl listen={() => new ScriptedDictation('create a researcher')} voice={spoken} />);
        const button = screen.getByRole('button', { name: 'Hold to talk' });
        fireEvent.pointerDown(button);
        fireEvent.pointerUp(button);
        fireEvent.pointerUp(button);
        fireEvent.lostPointerCapture(button);
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(screen.queryByText("I didn't hear anything.")).toBeNull();
        expect(spoken.spoken).toEqual(['Added Researcher.']);
        expect(useBlockStore.getState().blocks).toHaveLength(1);
    });

    it('finishes the command when the window blurs', async () => {
        render(<VoiceControl listen={() => new ScriptedDictation('create an analyst')} voice={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.blur(window);
        expect(await screen.findByText('Added Analyst.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(1);
    });

    it('finishes the command when the tab hides', async () => {
        render(<VoiceControl listen={() => new ScriptedDictation('create a researcher')} voice={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(1);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('drops the microphone on unmount without applying a command', () => {
        let aborted = 0;
        const { unmount } = render(
            <VoiceControl
                listen={() => ({
                    start() {},
                    stop() { return Promise.resolve('create a researcher'); },
                    abort() { aborted += 1; }
                })}
                voice={voice()}
            />
        );
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        unmount();
        expect(aborted).toBe(1);
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('speaks when recognition cannot start', async () => {
        const spoken = voice();
        render(
            <VoiceControl
                listen={() => ({
                    start() { throw new Error('This browser has no speech recognition.'); },
                    stop() { return Promise.resolve(''); },
                    abort() {}
                })}
                voice={spoken}
            />
        );
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('This browser has no speech recognition.')).toBeTruthy();
        expect(spoken.spoken).toEqual(['This browser has no speech recognition.']);
        expect(screen.getByRole('button', { name: 'Hold to talk' }).getAttribute('aria-pressed')).toBe('false');
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('says when it heard nothing', async () => {
        const spoken = voice();
        render(<VoiceControl listen={() => new ScriptedDictation('  ')} voice={spoken} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText("I didn't hear anything.")).toBeTruthy();
        expect(spoken.spoken).toEqual(["I didn't hear anything."]);
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });
});
