import { describe, expect, it, vi } from 'vitest';
import { createPushToTalk } from './pushToTalk';
import { recognizerAdapter, type RecognitionLike } from './browserSpeechAdapter';
import { scriptedSpeechAdapter } from './scriptedSpeechAdapter';
import type { SpeechObservationV1 } from './speechObservation';

function recognizer(overrides: Partial<RecognitionLike> = {}): RecognitionLike {
    return {
        continuous: false,
        interimResults: false,
        lang: '',
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(),
        stop: vi.fn(),
        abort: vi.fn(),
        ...overrides
    };
}

describe('push to talk', () => {
    it('starts on press and returns the transcript on release', async () => {
        const adapter = scriptedSpeechAdapter({ final: 'add hacker news' });
        const talk = createPushToTalk(adapter);
        void talk.press();
        void talk.press();
        expect(adapter.starts).toBe(1);
        await expect(talk.release()).resolves.toMatchObject({ transcript: 'add hacker news', heard: true });
        expect(adapter.stops).toBe(1);
        await expect(talk.release()).resolves.toEqual({ transcript: '', heard: false });
    });

    it('reports silence and a recognizer that cannot start', async () => {
        const silent = createPushToTalk(scriptedSpeechAdapter({ final: '   ' }));
        void silent.press();
        await expect(silent.release()).resolves.toMatchObject({ transcript: '', heard: false });

        const broken = createPushToTalk(scriptedSpeechAdapter({ failOnStart: 'unsupported' }));
        const failed = await broken.press();
        expect(failed?.error?.message).toBe('This browser has no speech recognition.');
        expect(failed?.error?.code).toBe('unsupported');
        expect(broken.held).toBe(false);
    });

    it('creates the session id itself and hands it to the adapter', async () => {
        const adapter = scriptedSpeechAdapter({ final: 'undo' });
        const talk = createPushToTalk(adapter, { newSessionId: () => 'omni-session-7' });
        void talk.press();
        const heard = await talk.release();
        expect(adapter.sessions).toEqual(['omni-session-7']);
        expect(heard.observation?.sessionId).toBe('omni-session-7');
        expect(heard.observation?.final).toBe(true);
    });

    it('passes partials to display only and returns one final', async () => {
        const partials: SpeechObservationV1[] = [];
        const talk = createPushToTalk(
            scriptedSpeechAdapter({ partials: ['add', 'add hacker'], final: 'add hacker news', echoFinal: true }),
            { onPartial: observation => partials.push(observation) }
        );
        await talk.press();
        const heard = await talk.release();
        expect(partials.map(item => [item.transcript, item.final])).toEqual([['add', false], ['add hacker', false]]);
        expect(heard.observation?.transcript).toBe('add hacker news');
        expect(heard.timings?.firstDeltaAtMs).toBeTypeOf('number');
    });

    it('cancel aborts the signal, cancels the capture, and returns nothing', async () => {
        const adapter = scriptedSpeechAdapter({ final: 'delete this' });
        const talk = createPushToTalk(adapter);
        void talk.press();
        talk.cancel();
        expect(adapter.signals[0].aborted).toBe(true);
        await vi.waitFor(() => expect(adapter.cancels).toBe(1));
        expect(talk.held).toBe(false);
        await expect(talk.release()).resolves.toEqual({ transcript: '', heard: false });
        expect(adapter.stops).toBe(0);
    });

    it('reports a start failure once, through release, when release came first', async () => {
        let reject!: (error: Error) => void;
        const talk = createPushToTalk({
            id: 'slow', captureKind: 'synthetic',
            start: () => new Promise((_, fail) => { reject = fail; })
        });
        const pressed = talk.press();
        const released = talk.release();
        reject(new Error('boom'));
        await expect(pressed).resolves.toBeUndefined();
        await expect(released).resolves.toMatchObject({ heard: false, error: { code: 'provider-error' } });
    });
});

describe('browser recognizer adapter', () => {
    it('resolves the final transcript when recognition ends', async () => {
        let created: RecognitionLike | undefined;
        const adapter = recognizerAdapter(() => {
            created = recognizer({
                stop: vi.fn(function stop(this: RecognitionLike) {
                    this.onresult?.({
                        results: [{ 0: { transcript: 'open investor' }, isFinal: true, length: 1 }]
                    });
                    this.onend?.();
                })
            });
            return created;
        });
        const talk = createPushToTalk(adapter);
        await talk.press();
        const heard = await talk.release();
        expect(heard.transcript).toBe('open investor');
        expect(heard.observation?.provider.adapterId).toBe('browser-web-speech');
        expect(heard.observation?.locale).toBe('en-US');
        expect(created?.continuous).toBe(true);
        expect(created?.interimResults).toBe(true);
        expect(created?.lang).toBe('en-US');
    });

    it('keeps listening until release, and does not hang if recognition never ends', async () => {
        vi.useFakeTimers();
        try {
            const talk = createPushToTalk(recognizerAdapter(() => recognizer()));
            await talk.press();
            const pending = talk.release();
            await vi.advanceTimersByTimeAsync(2000);
            await expect(pending).resolves.toMatchObject({ transcript: '', heard: false });
        } finally {
            vi.useRealTimers();
        }
    });

    it('reports a refused microphone instead of silence', async () => {
        const talk = createPushToTalk(recognizerAdapter(() => recognizer({
            interimResults: true,
            stop: vi.fn(function stop(this: RecognitionLike) {
                this.onerror?.({ error: 'not-allowed' });
                this.onend?.();
            })
        })));
        expect(await talk.press()).toBeUndefined();
        const heard = await talk.release();
        expect(heard).toMatchObject({ transcript: '', heard: false });
        expect(heard.error?.message).toBe('Microphone permission was refused.');
        expect(heard.error?.code).toBe('permission-denied');
        expect(heard.observation).toBeUndefined();
    });

    it('treats no-speech as an empty transcript', async () => {
        const talk = createPushToTalk(recognizerAdapter(() => recognizer({
            stop: vi.fn(function stop(this: RecognitionLike) {
                this.onerror?.({ error: 'no-speech' });
                this.onend?.();
            })
        })));
        await talk.press();
        await expect(talk.release()).resolves.toMatchObject({ transcript: '', heard: false });
    });

    it('emits interim results as non-final observations, and nothing after cancel', async () => {
        let created: RecognitionLike | undefined;
        const seen: SpeechObservationV1[] = [];
        const adapter = recognizerAdapter(() => {
            created = recognizer();
            return created;
        });
        const talk = createPushToTalk(adapter, { onPartial: observation => seen.push(observation) });
        await talk.press();
        created?.onresult?.({ results: [{ 0: { transcript: 'delete' }, isFinal: false, length: 1 }] });
        expect(seen.map(item => item.final)).toEqual([false]);
        talk.cancel();
        await vi.waitFor(() => expect(created?.abort).toHaveBeenCalled());
        created?.onresult?.({ results: [{ 0: { transcript: 'delete this' }, isFinal: true, length: 1 }] });
        expect(seen).toHaveLength(1);
    });
});
