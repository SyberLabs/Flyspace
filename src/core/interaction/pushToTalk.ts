// One press is one speech session. Capture only: no parsing, no commands.

import {
    createSpeechSessionId,
    normalizeSpeechError,
    type SpeechAdapter,
    type SpeechAdapterError,
    type SpeechCapture,
    type SpeechObservationV1
} from './speechObservation';

export interface Heard {
    transcript: string;
    heard: boolean;
    error?: SpeechAdapterError;
    /** The one final observation for this session, when there was speech. */
    observation?: SpeechObservationV1;
}

export interface PushToTalkTimings {
    sessionId: string;
    captureRequestedAtMs: number;
    microphoneActiveAtMs?: number;
    firstDeltaAtMs?: number;
    stopRequestedAtMs?: number;
    finalAtMs?: number;
}

export interface PushToTalkOptions {
    locale?: string;
    newSessionId?: () => string;
    now?: () => number;
    /** Interim observations for display only. They never reach the engine. */
    onPartial?: (observation: SpeechObservationV1) => void;
    /** The microphone is live on this capture. */
    onListening?: (capture: SpeechCapture) => void;
}

export interface PushToTalk {
    readonly held: boolean;
    readonly adapterId: string;
    /** Resolves with an error when capture could not start, otherwise undefined. */
    press(): Promise<Heard | undefined>;
    release(): Promise<Heard & { timings?: PushToTalkTimings }>;
    /** Drop the microphone without turning the audio into a command. */
    cancel(): void;
}

interface Pending {
    sessionId: string;
    abort: AbortController;
    capture: Promise<SpeechCapture>;
    timings: PushToTalkTimings;
}

export function createPushToTalk(adapter: SpeechAdapter, options: PushToTalkOptions = {}): PushToTalk {
    const now = options.now ?? Date.now;
    const newSessionId = options.newSessionId ?? createSpeechSessionId;
    let current: Pending | null = null;

    function failed(error: unknown): Heard {
        return { transcript: '', heard: false, error: normalizeSpeechError(error) };
    }

    return {
        get held() {
            return current !== null;
        },
        get adapterId() {
            return adapter.id;
        },
        press() {
            if (current) return Promise.resolve(undefined);
            const sessionId = newSessionId();
            const abort = new AbortController();
            const timings: PushToTalkTimings = { sessionId, captureRequestedAtMs: now() };
            let capture: Promise<SpeechCapture>;
            try {
                capture = adapter.start({
                    sessionId,
                    locale: options.locale,
                    signal: abort.signal,
                    onObservation(observation) {
                        if (observation.sessionId !== sessionId || abort.signal.aborted) return;
                        if (observation.final) return;
                        timings.firstDeltaAtMs ??= now();
                        options.onPartial?.(observation);
                    }
                });
            } catch (error) {
                capture = Promise.reject(error);
            }
            const entry: Pending = { sessionId, abort, capture, timings };
            current = entry;
            return capture.then(
                started => {
                    timings.microphoneActiveAtMs = now();
                    if (current === entry) options.onListening?.(started);
                    return undefined;
                },
                error => {
                    // Release or cancel already owns this session; they report its outcome.
                    if (current !== entry) return undefined;
                    current = null;
                    return failed(error);
                }
            );
        },
        async release() {
            const entry = current;
            if (!entry) return { transcript: '', heard: false };
            current = null;
            let capture: SpeechCapture;
            try {
                capture = await entry.capture;
            } catch (error) {
                return failed(error);
            }
            entry.timings.stopRequestedAtMs = now();
            let final: SpeechObservationV1 | null;
            try {
                final = await capture.stop();
            } catch (error) {
                return { ...failed(error), timings: entry.timings };
            }
            if (!final || !final.final || final.sessionId !== entry.sessionId) {
                return { transcript: '', heard: false, timings: entry.timings };
            }
            entry.timings.finalAtMs = now();
            const transcript = final.transcript.trim();
            return {
                transcript,
                heard: transcript.length > 0,
                observation: transcript ? final : undefined,
                timings: entry.timings
            };
        },
        cancel() {
            const entry = current;
            current = null;
            if (!entry) return;
            entry.abort.abort();
            void entry.capture.then(capture => capture.cancel(), () => undefined).catch(() => undefined);
        }
    };
}
