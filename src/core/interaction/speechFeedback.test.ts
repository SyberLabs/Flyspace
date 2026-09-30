// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserSpeechFeedback, emitFeedback, type SpeechFeedbackAdapter } from './speechFeedback';

class FakeUtterance {
    lang = 'en-US';
    volume = 1;
    onend: (() => void) | null = null;
    onerror: ((event: { error?: string }) => void) | null = null;
    constructor(public text: string) {}
}

interface FakeSynth {
    queue: FakeUtterance[];
    cancel: ReturnType<typeof vi.fn>;
    speak: (utterance: FakeUtterance) => void;
    readonly pending: boolean;
    readonly speaking: boolean;
}

function installSynth(seed: FakeUtterance[] = []): FakeSynth {
    const queue = [...seed];
    const synth: FakeSynth = {
        queue,
        get pending() {
            return queue.length > 1;
        },
        get speaking() {
            return queue.length > 0;
        },
        speak(utterance) {
            queue.push(utterance);
        },
        cancel: vi.fn(() => {
            queue.splice(0, queue.length);
        })
    };
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    window.speechSynthesis = synth as unknown as SpeechSynthesis;
    return synth;
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
});

describe('browser speech feedback', () => {
    it('does not cancel a Speak-block utterance already queued', () => {
        const content = new FakeUtterance('The article says markets opened higher.');
        const synth = installSynth([content]);
        const feedback = browserSpeechFeedback();

        expect(emitFeedback(feedback, 'Placed Hacker News.')).toBe(true);
        feedback.cancel();

        expect(synth.cancel).not.toHaveBeenCalled();
        expect(synth.queue[0]).toBe(content);
        expect(content.volume).toBe(1);
        expect(content.text).toBe('The article says markets opened higher.');
        const spoken = synth.queue.find(item => item.text === 'Placed Hacker News.');
        expect(spoken).toBeDefined();
        expect(spoken!.volume).toBe(0);
    });

    it('does not blanket-cancel when this adapter has not spoken', () => {
        const content = new FakeUtterance('Still reading.');
        const synth = installSynth([content]);
        browserSpeechFeedback().cancel();
        expect(synth.cancel).not.toHaveBeenCalled();
        expect(synth.queue).toEqual([content]);
    });

    it('stops the utterance this adapter started when nothing else is queued', () => {
        const synth = installSynth();
        const feedback = browserSpeechFeedback();
        expect(emitFeedback(feedback, 'Deleted Hacker News.')).toBe(true);
        expect(synth.queue.map(item => item.text)).toEqual(['Deleted Hacker News.']);
        feedback.cancel();
        expect(synth.cancel).toHaveBeenCalledOnce();
        expect(synth.queue).toEqual([]);
    });

    it('a feedback failure leaves a committed command in place', () => {
        const command = { lifecycle: 'committed' as const, id: 'cmd-1' };
        const feedback: SpeechFeedbackAdapter = {
            id: 'broken-synth',
            cancel() {},
            speak() {
                throw new Error('synthesis failed');
            }
        };
        expect(emitFeedback(feedback, 'Deleted Hacker News.')).toBe(false);
        expect(command).toEqual({ lifecycle: 'committed', id: 'cmd-1' });
    });
});
