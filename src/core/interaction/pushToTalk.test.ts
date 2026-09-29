import { describe, expect, it, vi } from 'vitest';
import { createPushToTalk, dictationFromRecognizer, type DictationSession, type RecognitionLike } from './pushToTalk';

class ScriptedDictation implements DictationSession {
    starts = 0;
    stops = 0;
    constructor(private readonly text: string, private readonly failure?: string) {}
    start() {
        this.starts += 1;
        if (this.failure) throw new Error(this.failure);
    }
    stop() {
        this.stops += 1;
        return Promise.resolve(this.text);
    }
    abort() {}
}

describe('push to talk', () => {
    it('starts on press and returns the transcript on release', async () => {
        const session = new ScriptedDictation('add hacker news');
        const talk = createPushToTalk(() => session);
        talk.press();
        talk.press();
        expect(session.starts).toBe(1);
        await expect(talk.release()).resolves.toEqual({ transcript: 'add hacker news', heard: true });
        expect(session.stops).toBe(1);
        await expect(talk.release()).resolves.toEqual({ transcript: '', heard: false });
    });

    it('reports silence and a recognizer that cannot start', async () => {
        const silent = createPushToTalk(() => new ScriptedDictation('   '));
        silent.press();
        await expect(silent.release()).resolves.toEqual({ transcript: '', heard: false });

        const broken = createPushToTalk(() => new ScriptedDictation('', 'This browser has no speech recognition.'));
        const failed = broken.press();
        expect(failed?.error).toBe('This browser has no speech recognition.');
        expect(broken.held).toBe(false);
    });
});

describe('dictation session', () => {
    it('resolves the final transcript when recognition ends', async () => {
        let recognizer: RecognitionLike | undefined;
        const session = dictationFromRecognizer(() => {
            recognizer = {
                continuous: true,
                interimResults: false,
                lang: '',
                onresult: null,
                onerror: null,
                onend: null,
                start: vi.fn(),
                stop: vi.fn(function stop(this: RecognitionLike) {
                    this.onresult?.({
                        results: [{ 0: { transcript: 'open investor' }, isFinal: true, length: 1 }]
                    });
                    this.onend?.();
                }),
                abort: vi.fn()
            };
            return recognizer;
        });
        session.start();
        await expect(session.stop()).resolves.toBe('open investor');
        expect(recognizer?.continuous).toBe(true);
        expect(recognizer?.interimResults).toBe(true);
        expect(recognizer?.lang).toBe('en-US');
    });

    it('keeps listening until release, and does not hang if recognition never ends', async () => {
        vi.useFakeTimers();
        try {
            const session = dictationFromRecognizer(() => ({
                continuous: false,
                interimResults: false,
                lang: '',
                onresult: null,
                onerror: null,
                onend: null,
                start: vi.fn(),
                stop: vi.fn(),
                abort: vi.fn()
            }));
            session.start();
            const pending = session.stop();
            await vi.advanceTimersByTimeAsync(2000);
            await expect(pending).resolves.toBe('');
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports a refused microphone instead of silence', async () => {
        const session = dictationFromRecognizer(() => ({
            continuous: false,
            interimResults: true,
            lang: '',
            onresult: null,
            onerror: null,
            onend: null,
            start: vi.fn(),
            stop: vi.fn(function stop(this: RecognitionLike) {
                this.onerror?.({ error: 'not-allowed' });
                this.onend?.();
            }),
            abort: vi.fn()
        }));
        const talk = createPushToTalk(() => session);
        expect(talk.press()).toBeUndefined();
        await expect(talk.release()).resolves.toEqual({
            transcript: '',
            heard: false,
            error: 'Microphone permission was refused.'
        });
    });

    it('treats no-speech as an empty transcript', async () => {
        const session = dictationFromRecognizer(() => ({
            continuous: false,
            interimResults: true,
            lang: 'en-US',
            onresult: null,
            onerror: null,
            onend: null,
            start: vi.fn(),
            stop: vi.fn(function stop(this: RecognitionLike) {
                this.onerror?.({ error: 'no-speech' });
                this.onend?.();
            }),
            abort: vi.fn()
        }));
        session.start();
        await expect(session.stop()).resolves.toBe('');
    });
});
