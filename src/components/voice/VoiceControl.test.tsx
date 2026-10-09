// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VoiceControl } from './VoiceControl';
import { useBlockStore, useUIStore } from '@/core/stores';
import { spatialSession } from '@/core/interaction/session';
import { scriptedSpeechAdapter } from '@/core/interaction/scriptedSpeechAdapter';
import type { SpeechFeedbackAdapter } from '@/core/interaction/speechFeedback';

function voice(): SpeechFeedbackAdapter & { spoken: string[] } {
    return {
        id: 'recorded',
        spoken: [],
        speak(text: string) { this.spoken.push(text); },
        cancel() {}
    };
}

function saying(text: string) {
    return scriptedSpeechAdapter({ final: text });
}

describe('VoiceControl', () => {
    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useUIStore.setState({ commandPaletteOpen: false });
    });

    it('holds to talk, runs the canvas command, and speaks the reply', async () => {
        const spoken = voice();
        render(<VoiceControl adapter={saying('create a researcher')} feedback={spoken} />);
        expect(screen.queryByLabelText('Spoken command')).toBeNull();
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(useBlockStore.getState().blocks.some(block => block.schema.block_id === 'persona_researcher')).toBe(true);
        expect(spoken.spoken).toEqual(['Added Researcher.']);
    });

    it('names the speech observation on the committed command and trace', async () => {
        const adapter = saying('create an analyst');
        render(<VoiceControl adapter={adapter} feedback={voice()} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('Added Analyst.')).toBeTruthy();
        const snapshot = spatialSession.snapshot();
        const committed = snapshot.commands[snapshot.commands.length - 1];
        expect(committed.lifecycle).toBe('committed');
        expect(committed.speech?.sessionId).toBe(adapter.sessions[0]);
        expect(committed.speech?.adapterId).toBe('scripted-speech');
        expect(committed.speech?.observationId).toMatch(new RegExp(`^${adapter.sessions[0]}:`));
        expect(committed.evidence).toContain(`speech-observation:${committed.speech?.observationId}`);
        const trace = snapshot.traces[snapshot.traces.length - 1];
        expect(trace.speechObservationId).toBe(committed.speech?.observationId);
    });

    it('holds the space bar outside a text field', async () => {
        render(<VoiceControl adapter={saying('create an analyst')} feedback={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.keyUp(window, { code: 'Space', key: ' ' });
        expect(await screen.findByText('Added Analyst.')).toBeTruthy();
    });

    it('does not steal space while typing', async () => {
        const adapter = saying('create an analyst');
        render(
            <div>
                <input aria-label="Note" />
                <VoiceControl adapter={adapter} feedback={voice()} />
            </div>
        );
        const field = screen.getByLabelText('Note');
        field.focus();
        fireEvent.keyDown(field, { code: 'Space', key: ' ' });
        fireEvent.keyUp(field, { code: 'Space', key: ' ' });
        expect(screen.queryByText('Added Analyst.')).toBeNull();
        expect(useBlockStore.getState().blocks).toHaveLength(0);
        expect(adapter.starts).toBe(0);
    });

    it('starts listening even if pointer capture is unavailable', () => {
        render(<VoiceControl adapter={saying('create a researcher')} feedback={voice()} />);
        const button = screen.getByRole('button', { name: 'Hold to talk' });
        button.setPointerCapture = () => {
            throw new Error('No active pointer with the given id is found.');
        };
        fireEvent.pointerDown(button);
        expect(button.getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByRole('status').textContent).toBe('Listening');
    });

    it('shows which provider is listening', async () => {
        render(<VoiceControl adapter={saying('create a researcher')} feedback={voice()} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        expect((await screen.findByLabelText('Speech provider')).textContent).toBe('Scripted transcript');
    });

    it('does not steal space from another button', () => {
        render(
            <div>
                <button type="button">Browse shells</button>
                <VoiceControl adapter={saying('create an analyst')} feedback={voice()} />
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
        render(<VoiceControl adapter={saying('create an analyst')} feedback={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.keyUp(window, { code: 'Space', key: ' ' });
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('applies one command when the pointer releases twice', async () => {
        const spoken = voice();
        render(<VoiceControl adapter={saying('create a researcher')} feedback={spoken} />);
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

    it('applies one command when the provider also echoes the final', async () => {
        render(<VoiceControl adapter={scriptedSpeechAdapter({ final: 'create a researcher', echoFinal: true })} feedback={voice()} />);
        const button = screen.getByRole('button', { name: 'Hold to talk' });
        fireEvent.pointerDown(button);
        fireEvent.pointerUp(button);
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(1);
    });

    it('finishes the command when the window blurs', async () => {
        render(<VoiceControl adapter={saying('create an analyst')} feedback={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        fireEvent.blur(window);
        expect(await screen.findByText('Added Analyst.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(1);
    });

    it('finishes the command when the tab hides', async () => {
        render(<VoiceControl adapter={saying('create a researcher')} feedback={voice()} />);
        fireEvent.keyDown(window, { code: 'Space', key: ' ' });
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(1);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('drops the microphone on unmount without applying a command', async () => {
        const adapter = saying('create a researcher');
        const { unmount } = render(<VoiceControl adapter={adapter} feedback={voice()} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        unmount();
        expect(adapter.signals[0].aborted).toBe(true);
        await waitFor(() => expect(adapter.cancels).toBe(1));
        expect(adapter.stops).toBe(0);
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('speaks when recognition cannot start', async () => {
        const spoken = voice();
        render(<VoiceControl adapter={scriptedSpeechAdapter({ failOnStart: 'unsupported' })} feedback={spoken} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('This browser has no speech recognition.')).toBeTruthy();
        expect(spoken.spoken).toEqual(['This browser has no speech recognition.']);
        expect(screen.getByRole('button', { name: 'Hold to talk' }).getAttribute('aria-pressed')).toBe('false');
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('says when it heard nothing', async () => {
        const spoken = voice();
        render(<VoiceControl adapter={saying('  ')} feedback={spoken} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText("I didn't hear anything.")).toBeTruthy();
        expect(spoken.spoken).toEqual(["I didn't hear anything."]);
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });

    it('keeps the command when spoken feedback throws, and replies can be turned off', async () => {
        const broken: SpeechFeedbackAdapter = {
            id: 'broken',
            speak() { throw new Error('synthesizer crashed'); },
            cancel() { throw new Error('synthesizer crashed'); }
        };
        const { unmount } = render(<VoiceControl adapter={saying('create a researcher')} feedback={broken} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('Added Researcher.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(1);
        unmount();

        const spoken = voice();
        render(<VoiceControl adapter={saying('create an analyst')} feedback={spoken} />);
        fireEvent.click(screen.getByRole('button', { name: 'Spoken replies' }));
        expect(screen.getByRole('button', { name: 'Spoken replies' }).getAttribute('aria-pressed')).toBe('false');
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('Added Analyst.')).toBeTruthy();
        expect(spoken.spoken).toEqual([]);
        expect(useBlockStore.getState().blocks).toHaveLength(2);
    });

    it('turns a refused microphone into a reply, never a command', async () => {
        render(<VoiceControl adapter={scriptedSpeechAdapter({ final: 'create a researcher', failOnStop: 'permission-denied' })} feedback={voice()} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
        fireEvent.pointerUp(screen.getByRole('button', { name: 'Hold to talk' }));
        expect(await screen.findByText('Microphone permission was refused.')).toBeTruthy();
        expect(useBlockStore.getState().blocks).toHaveLength(0);
    });
});
