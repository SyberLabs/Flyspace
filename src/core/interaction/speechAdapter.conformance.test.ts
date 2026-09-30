import { describe, expect, it, vi } from 'vitest';
import { InteractionEngine } from './engine';
import { MemoryCanvas } from './memoryCanvas';
import { recognizerAdapter, type RecognitionLike } from './browserSpeechAdapter';
import { scriptedSpeechAdapter } from './scriptedSpeechAdapter';
import { openaiRealtimeAdapter } from './openaiRealtimeAdapter';
import { answerCommit, fakeRealtime } from './realtimeFakes';
import { createSpeechInput, type SpeechAuthority } from './speechInput';
import { isSpeechObservationV1, type SpeechAdapter, type SpeechErrorCode, type SpeechObservationV1 } from './speechObservation';

interface ConformanceScript {
    partials: string[];
    final: string | null;
    failOnStart?: boolean;
    failOnStop?: 'permission-denied' | 'network';
}

interface Driver {
    name: string;
    make(script: ConformanceScript): SpeechAdapter;
    /** The Omni error a provider-specific mid-capture failure normalizes to. */
    stopError?: (code: 'permission-denied' | 'network') => SpeechErrorCode;
}

function realtimeDriver(script: ConformanceScript): SpeechAdapter {
    const fake = fakeRealtime({
        sessionStatus: script.failOnStart ? 500 : undefined,
        onChannel(channel, peer) {
            const open = channel.open.bind(channel);
            channel.open = () => {
                open();
                let previous = '';
                for (const partial of script.partials) {
                    channel.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', delta: partial.slice(previous.length) });
                    previous = partial;
                }
            };
            if (script.failOnStop === 'network') channel.onCommit = () => peer.fail();
            else if (script.failOnStop === 'permission-denied') channel.onCommit = () => channel.emit({ type: 'error', error: { code: 'server_error' } });
            else if (script.final) answerCommit(channel, 'item_1', script.final);
            else channel.onCommit = () => channel.emit({ type: 'error', error: { code: 'input_audio_buffer_commit_empty' } });
        }
    });
    return openaiRealtimeAdapter(fake.transport);
}

function fakeRecognizer(script: ConformanceScript): RecognitionLike {
    const result = (transcript: string, isFinal: boolean) => ({ results: [{ 0: { transcript }, isFinal, length: 1 }] });
    return {
        continuous: false,
        interimResults: false,
        lang: '',
        onresult: null,
        onerror: null,
        onend: null,
        start(this: RecognitionLike) {
            if (script.failOnStart) throw new Error('recognizer refused to start');
            for (const partial of script.partials) this.onresult?.(result(partial, false));
        },
        stop(this: RecognitionLike) {
            if (script.failOnStop) this.onerror?.({ error: script.failOnStop === 'permission-denied' ? 'not-allowed' : 'network' });
            else if (script.final) this.onresult?.(result(script.final, true));
            this.onend?.();
        },
        abort() {}
    };
}

const drivers: Driver[] = [
    {
        name: 'scripted adapter',
        make: script => scriptedSpeechAdapter({
            partials: script.partials,
            final: script.final,
            failOnStart: script.failOnStart ? 'provider-error' : undefined,
            failOnStop: script.failOnStop
        })
    },
    {
        name: 'browser recognizer adapter',
        make: script => recognizerAdapter(() => fakeRecognizer(script))
    },
    {
        name: 'OpenAI Realtime adapter over a fake peer',
        make: realtimeDriver,
        stopError: code => (code === 'network' ? 'disconnected' : 'provider-error')
    }
];

function harness(adapter: SpeechAdapter) {
    const canvas = new MemoryCanvas();
    const engine = new InteractionEngine(canvas);
    const heard: SpeechObservationV1[] = [];
    const authority: SpeechAuthority = {
        describeSpeechContext: () => engine.describeSpeechContext(),
        admitSpeech(observation, result) {
            heard.push(observation);
            return engine.admitSpeech(observation, result);
        }
    };
    const partials: SpeechObservationV1[] = [];
    const input = createSpeechInput({ adapter, authority, onPartial: observation => partials.push(observation) });
    return { canvas, engine, heard, partials, input };
}

describe.each(drivers)('speech adapter conformance: $name', driver => {
    it('starts, streams partials that never reach the engine, and commits one final', async () => {
        const { canvas, heard, partials, input } = harness(driver.make({ partials: ['create', 'create a'], final: 'create a researcher' }));
        await expect(input.press()).resolves.toBeUndefined();
        expect(input.held).toBe(true);
        expect(partials.length).toBeGreaterThan(0);
        expect(partials.every(item => item.final === false)).toBe(true);
        expect(heard).toHaveLength(0);
        expect(canvas.blocks).toHaveLength(0);

        const outcome = await input.release();
        expect(outcome?.kind).toBe('command');
        expect(heard).toHaveLength(1);
        expect(heard[0].final).toBe(true);
        expect(isSpeechObservationV1(heard[0])).toBe(true);
        expect(heard[0].provider.adapterId).toBe(driver.make({ partials: [], final: null }).id);
        expect(Object.keys(heard[0])).not.toContain('audio');
        expect(canvas.blocks.map(block => block.schema.block_id)).toEqual(['persona_researcher']);
    });

    it('a partial observation handed straight to the engine does not commit', async () => {
        const { canvas, engine, partials, input } = harness(driver.make({ partials: ['create a researcher'], final: null }));
        await input.press();
        const partial = partials[0];
        expect(partial.final).toBe(false);
        const command = engine.hear(partial);
        expect(command.lifecycle).toBe('refused');
        expect(command.reason).toBe('not-final');
        expect(canvas.blocks).toHaveLength(0);
        input.cancel();
    });

    it('cancel emits no command', async () => {
        const { canvas, heard, input } = harness(driver.make({ partials: ['delete'], final: 'create a researcher' }));
        await input.press();
        input.cancel();
        expect(input.held).toBe(false);
        await expect(input.release()).resolves.toBeUndefined();
        await vi.waitFor(() => expect(heard).toHaveLength(0));
        expect(canvas.blocks).toHaveLength(0);
    });

    it('a provider error on start emits no command', async () => {
        const { canvas, heard, input } = harness(driver.make({ partials: [], final: 'create a researcher', failOnStart: true }));
        const outcome = await input.press();
        expect(outcome?.kind).toBe('error');
        expect(input.held).toBe(false);
        expect(heard).toHaveLength(0);
        expect(canvas.blocks).toHaveLength(0);
    });

    it.each(['permission-denied', 'network'] as const)('a %s failure during capture emits no command', async code => {
        const { canvas, heard, input } = harness(driver.make({ partials: ['create a'], final: 'create a researcher', failOnStop: code }));
        await input.press();
        const outcome = await input.release();
        expect(outcome).toMatchObject({ kind: 'error', code: driver.stopError?.(code) ?? code });
        expect(heard).toHaveLength(0);
        expect(canvas.blocks).toHaveLength(0);
    });

    it('a duplicated final for the same session applies once', async () => {
        const { canvas, engine, heard, input } = harness(driver.make({ partials: [], final: 'create a researcher' }));
        await input.press();
        await input.release();
        const again = engine.hear({ ...heard[0], observationId: `${heard[0].observationId}-redelivered` });
        expect(again.lifecycle).toBe('refused');
        expect(again.reason).toBe('duplicate-final');
        expect(engine.hear(heard[0]).reason).toBe('duplicate-final');
        expect(canvas.blocks).toHaveLength(1);
    });
});

describe('observation contract', () => {
    const base: SpeechObservationV1 = {
        version: 1,
        sessionId: 's1',
        observationId: 's1:1',
        provider: { adapterId: 'scripted-speech' },
        startedAtMs: 1,
        receivedAtMs: 2,
        transcript: 'undo',
        final: true,
        source: 'microphone'
    };

    it('rejects extra fields such as raw audio, and bad confidence', () => {
        expect(isSpeechObservationV1(base)).toBe(true);
        expect(isSpeechObservationV1({ ...base, audio: 'UklGRg==' })).toBe(false);
        expect(isSpeechObservationV1({ ...base, provider: { adapterId: 'x', authority: 'admin' } })).toBe(false);
        expect(isSpeechObservationV1({ ...base, confidence: 2 })).toBe(false);
        expect(isSpeechObservationV1({ ...base, version: 2 })).toBe(false);
        expect(isSpeechObservationV1({ ...base, sessionId: '' })).toBe(false);
    });

    it('the engine refuses an invalid observation without an effect', () => {
        const canvas = new MemoryCanvas();
        const engine = new InteractionEngine(canvas);
        const command = engine.hear({ ...base, transcript: 'create a researcher', audio: 'x' } as SpeechObservationV1);
        expect(command).toMatchObject({ lifecycle: 'refused', reason: 'invalid-observation' });
        expect(canvas.blocks).toHaveLength(0);
    });

    it('confidence is advisory: low confidence does not block, high confidence does not admit', () => {
        const canvas = new MemoryCanvas();
        const engine = new InteractionEngine(canvas);
        expect(engine.hear({ ...base, sessionId: 'a', observationId: 'a:1', transcript: 'create a researcher', confidence: 0.01 }).lifecycle).toBe('committed');
        expect(engine.hear({ ...base, sessionId: 'b', observationId: 'b:1', transcript: 'make it pop', confidence: 1 }).lifecycle).toBe('refused');
        expect(canvas.blocks).toHaveLength(1);
    });

    it('a spoken confirm names both the preview observation and the confirming one', () => {
        const canvas = new MemoryCanvas();
        canvas.add('newsapi_feed', 'News Feed', 0, 0);
        const engine = new InteractionEngine(canvas);
        const preview = engine.hear({ ...base, sessionId: 'p', observationId: 'p:1', transcript: 'delete news feed' });
        expect(preview.lifecycle).toBe('previewing');
        const confirmed = engine.hear({ ...base, sessionId: 'c', observationId: 'c:1', transcript: 'confirm' });
        expect(confirmed.lifecycle).toBe('committed');
        expect(confirmed.speech?.observationId).toBe('c:1');
        expect(confirmed.evidence).toEqual(expect.arrayContaining(['speech-observation:p:1', 'speech-observation:c:1']));
        expect(canvas.blocks).toHaveLength(0);
    });
});
