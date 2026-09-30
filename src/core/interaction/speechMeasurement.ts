// Speech timing measurement. No number here is a measurement until a live
// capture on real hardware produced it.

export type SpeechMetric =
    | 'pressToMicrophoneReady'
    | 'speechEndToFinalTranscript'
    | 'finalTranscriptToDecision'
    | 'decisionToCommit'
    | 'speechEndToCommit';

export interface SpeechTimingSample {
    adapterId: string;
    captureKind: 'live' | 'synthetic';
    captureRequestedAtMs: number;
    microphoneActiveAtMs?: number;
    firstDeltaAtMs?: number;
    stopRequestedAtMs?: number;
    finalAtMs?: number;
    decidedAtMs?: number;
    committedAtMs?: number;
    lifecycle?: string;
}

export type MetricSummary =
    | { metric: SpeechMetric; measured: false; samples: number; reason: string }
    | { metric: SpeechMetric; measured: true; samples: number; p50Ms: number; p95Ms: number };

/**
 * Committed state of speech measurement for this repository.
 * Flip an entry only with a recorder export from a real microphone session,
 * and say which hardware, browser, and provider produced it.
 */
export const SPEECH_MEASUREMENTS = {
    measured: false,
    reason: 'No live microphone capture has been run. The build environment has no microphone and no OPENAI_API_KEY.',
    adapters: {
        'browser-web-speech': { measured: false, reason: 'not measured: no live microphone session recorded' },
        'openai-realtime': { measured: false, reason: 'not measured: no live microphone session or OPENAI_API_KEY available' }
    },
    metrics: {
        pressToMicrophoneReady: 'not measured',
        speechEndToFinalTranscript: 'not measured',
        finalTranscriptToDecision: 'not measured',
        decisionToCommit: 'not measured',
        speechEndToCommit: 'not measured',
        transcriptionFailureRate: 'not measured',
        cancellationSuccessRate: 'not measured'
    }
} as const;

/** A policy floor, not a claim about variance: below it the recorder reports no percentiles. */
export const MIN_SAMPLES_FOR_PERCENTILES = 20;

function span(from: number | undefined, to: number | undefined): number | null {
    if (from === undefined || to === undefined) return null;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null;
    return to - from;
}

function metricValue(sample: SpeechTimingSample, metric: SpeechMetric): number | null {
    switch (metric) {
        case 'pressToMicrophoneReady': return span(sample.captureRequestedAtMs, sample.microphoneActiveAtMs);
        case 'speechEndToFinalTranscript': return span(sample.stopRequestedAtMs, sample.finalAtMs);
        case 'finalTranscriptToDecision': return span(sample.finalAtMs, sample.decidedAtMs);
        case 'decisionToCommit': return span(sample.decidedAtMs, sample.committedAtMs);
        case 'speechEndToCommit': return span(sample.stopRequestedAtMs, sample.committedAtMs);
    }
}

function nearestRank(sorted: number[], percentile: number): number {
    const rank = Math.ceil((percentile / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export class SpeechTimingRecorder {
    private readonly entries: SpeechTimingSample[] = [];

    constructor(private readonly limit = 1000) {}

    /** Stores a sample only from a live capture with ordered, finite timestamps. */
    record(sample: SpeechTimingSample): boolean {
        if (sample.captureKind !== 'live') return false;
        if (!sample.adapterId) return false;
        const stamps = [
            sample.captureRequestedAtMs,
            sample.microphoneActiveAtMs,
            sample.stopRequestedAtMs,
            sample.finalAtMs,
            sample.decidedAtMs
        ];
        if (stamps.some(value => value === undefined || !Number.isFinite(value))) return false;
        for (let index = 1; index < stamps.length; index += 1) {
            if ((stamps[index] as number) < (stamps[index - 1] as number)) return false;
        }
        if (sample.committedAtMs !== undefined && (!Number.isFinite(sample.committedAtMs) || sample.committedAtMs < (sample.decidedAtMs as number))) {
            return false;
        }
        this.entries.push({ ...sample });
        if (this.entries.length > this.limit) this.entries.shift();
        return true;
    }

    samples(): SpeechTimingSample[] {
        return this.entries.map(entry => ({ ...entry }));
    }

    summarize(metric: SpeechMetric, adapterId?: string): MetricSummary {
        const values = this.entries
            .filter(entry => !adapterId || entry.adapterId === adapterId)
            .map(entry => metricValue(entry, metric))
            .filter((value): value is number => value !== null)
            .sort((left, right) => left - right);
        if (values.length === 0) {
            return { metric, measured: false, samples: 0, reason: 'no live samples' };
        }
        if (values.length < MIN_SAMPLES_FOR_PERCENTILES) {
            return { metric, measured: false, samples: values.length, reason: `fewer than ${MIN_SAMPLES_FOR_PERCENTILES} live samples` };
        }
        return { metric, measured: true, samples: values.length, p50Ms: nearestRank(values, 50), p95Ms: nearestRank(values, 95) };
    }
}

/** In-memory only. Holds timestamps and adapter ids: no audio, no transcripts. */
export const liveSpeechTimings = new SpeechTimingRecorder();
