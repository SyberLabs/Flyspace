// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { clearCapabilities, ensureSpeechCapabilities } from './registry';
import { executeCapability } from './execute';
import { setSpeechEngine } from './speech';

class FakeUtterance {
    onend: (() => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    constructor(public text: string) {}
}

afterEach(() => {
    setSpeechEngine(null);
    clearCapabilities();
    vi.unstubAllGlobals();
});

describe('browser speech engine', () => {
    it('speaks on a later turn after cancel so the utterance is not dropped', async () => {
        const spoken: string[] = [];
        vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
        const synth = {
            speaking: true,
            pending: false,
            getVoices: () => [{ voiceURI: 'test' } as SpeechSynthesisVoice],
            addEventListener() {},
            removeEventListener() {},
            cancel(this: { speaking: boolean }) {
                this.speaking = false;
            },
            speak(utterance: FakeUtterance) {
                spoken.push(utterance.text);
                utterance.onend?.();
            }
        };
        window.speechSynthesis = synth as unknown as SpeechSynthesis;

        setSpeechEngine(null);
        ensureSpeechCapabilities();
        const result = await executeCapability('cap_speech_speak', { text: 'later' });
        expect(spoken).toEqual(['later']);
        expect(result.ok).toBe(true);
        expect(result.typed?.value).toEqual({ spoken: 'later' });
    });
});