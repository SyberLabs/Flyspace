// One press is one speech session. Capture only: no parsing, no commands.

import {
    createSpeechSessionId,
    normalizeSpeechError,
    type SpeechAdapter,
    type SpeechAdapterError,
    type SpeechCapture,
    type SpeechObservationV1
} from './speechObservation';

interface Heard {
    transcript: string;
    heard: boolean;
    error?: SpeechAdapterError;
    /** The one final observation for this session, when there was speech. */
    observation?: SpeechObservationV1;
}

export interface PushToTalkOptions {
    locale?: string;
    newSessionId?: () => string;
    /** Interim observations for display only. They never reach the engine. */
    onPartial?: (observation: SpeechObservationV1) => void;
    /** The microphone is live on this capture. */
    onListening?: (capture: SpeechCapture) => void;
}

interface PushToTalk {
    readonly held: boolean;
    readonly adapterId: string;
    /** Resolves with an error when capture could not start, otherwise undefined. */
    press(): Promise<Heard | undefined>;
    release(): Promise<Heard>;
    /** Drop the microphone without turning the audio into a command. */
    cancel(): void;
}

interface Pending {
    sessionId: string;
    abort: AbortController;
    capture: Promise<SpeechCapture>;
}

export function createPushToTalk(adapter: SpeechAdapter, options: PushToTalkOptions = {}): PushToTalk {
    const newSessionId = options.newSessionId ?? createSpeechSessionId;
    let current: Pending | null = null;
    // A released session still starting or finalizing. Cancel must reach it:
    // until it settles, its secret request, microphone or peer can still open.
    let releasing: Pending | null = null;

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
            let capture: Promise<SpeechCapture>;
            try {
                capture = adapter.start({
                    sessionId,
                    locale: options.locale,
                    signal: abort.signal,
                    onObservation(observation) {
                        if (observation.sessionId !== sessionId || abort.signal.aborted) return;
                        if (observation.final) return;
                        options.onPartial?.(observation);
                    }
                });
            } catch (error) {
                capture = Promise.reject(error);
            }
            const entry: Pending = { sessionId, abort, capture };
            current = entry;
            return capture.then(
                started => {
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
            releasing = entry;
            try {
                return await settle(entry);
            } finally {
                if (releasing === entry) releasing = null;
            }
        },
        cancel() {
            const entries = [current, releasing].filter((item): item is Pending => item !== null);
            current = null;
            releasing = null;
            for (const entry of entries) {
                entry.abort.abort();
                void entry.capture.then(capture => capture.cancel(), () => undefined).catch(() => undefined);
            }
        }
    };

    async function settle(entry: Pending): Promise<Heard> {
        let capture: SpeechCapture;
        try {
            capture = await entry.capture;
        } catch (error) {
            if (entry.abort.signal.aborted) return { transcript: '', heard: false };
            return failed(error);
        }
        // Cancelled while starting: cancel() already cancels this capture.
        if (entry.abort.signal.aborted) return { transcript: '', heard: false };
        let final: SpeechObservationV1 | null;
        try {
            final = await capture.stop();
        } catch (error) {
            return failed(error);
        }
        if (entry.abort.signal.aborted) return { transcript: '', heard: false };
        if (!final || !final.final || final.sessionId !== entry.sessionId) {
            return { transcript: '', heard: false };
        }
        const transcript = final.transcript.trim();
        return {
            transcript,
            heard: transcript.length > 0,
            observation: transcript ? final : undefined
        };
    }
}
