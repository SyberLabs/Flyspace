import { describe, expect, it } from 'vitest';
import { InteractionEngine } from './engine';
import { MemoryCanvas } from './memoryCanvas';
import { scriptedSpeechAdapter } from './scriptedSpeechAdapter';
import { createSpeechInput } from './speechInput';
import { MIN_SAMPLES_FOR_PERCENTILES, SPEECH_MEASUREMENTS, SpeechTimingRecorder, type SpeechTimingSample } from './speechMeasurement';

function live(offset: number): SpeechTimingSample {
    return {
        adapterId: 'browser-web-speech',
        captureKind: 'live',
        captureRequestedAtMs: 0,
        microphoneActiveAtMs: 10,
        stopRequestedAtMs: 1000,
        finalAtMs: 1000 + offset,
        decidedAtMs: 1000 + offset,
        committedAtMs: 1000 + offset
    };
}

describe('speech measurement', () => {
    it('the committed state says nothing was measured, and why', () => {
        expect(SPEECH_MEASUREMENTS.measured).toBe(false);
        expect(SPEECH_MEASUREMENTS.reason).toMatch(/no live microphone/i);
        expect(Object.values(SPEECH_MEASUREMENTS.metrics).every(value => value === 'not measured')).toBe(true);
        expect(Object.values(SPEECH_MEASUREMENTS.adapters).every(entry => entry.measured === false)).toBe(true);
    });

    it('refuses to emit percentiles from zero samples', () => {
        const recorder = new SpeechTimingRecorder();
        const summary = recorder.summarize('speechEndToFinalTranscript');
        expect(summary).toEqual({ metric: 'speechEndToFinalTranscript', measured: false, samples: 0, reason: 'no live samples' });
        expect('p50Ms' in summary).toBe(false);
        expect('p95Ms' in summary).toBe(false);
    });

    it('refuses percentiles below the sample floor', () => {
        const recorder = new SpeechTimingRecorder();
        for (let index = 0; index < MIN_SAMPLES_FOR_PERCENTILES - 1; index += 1) recorder.record(live(index));
        expect(recorder.summarize('speechEndToFinalTranscript').measured).toBe(false);
    });

    it('stores only live captures with ordered timestamps', () => {
        const recorder = new SpeechTimingRecorder();
        expect(recorder.record({ ...live(5), captureKind: 'synthetic' })).toBe(false);
        expect(recorder.record({ ...live(5), microphoneActiveAtMs: undefined })).toBe(false);
        expect(recorder.record({ ...live(5), finalAtMs: 500 })).toBe(false);
        expect(recorder.record({ ...live(5), committedAtMs: 1 })).toBe(false);
        expect(recorder.record(live(5))).toBe(true);
        expect(recorder.samples()).toHaveLength(1);
    });

    it('computes nearest-rank percentiles once enough live samples exist', () => {
        const recorder = new SpeechTimingRecorder();
        for (let index = 1; index <= 20; index += 1) recorder.record(live(index * 10));
        expect(recorder.summarize('speechEndToFinalTranscript')).toEqual({
            metric: 'speechEndToFinalTranscript', measured: true, samples: 20, p50Ms: 100, p95Ms: 190
        });
        expect(recorder.summarize('speechEndToFinalTranscript', 'openai-realtime').measured).toBe(false);
    });

    it('a scripted capture never becomes a sample', async () => {
        const recorder = new SpeechTimingRecorder();
        const engine = new InteractionEngine(new MemoryCanvas());
        const input = createSpeechInput({ adapter: scriptedSpeechAdapter({ final: 'create a researcher' }), authority: engine, recorder });
        await input.press();
        const outcome = await input.release();
        expect(outcome?.kind).toBe('command');
        expect(recorder.samples()).toEqual([]);
    });
});
