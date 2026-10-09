// A synthetic SpeechAdapter for tests, the field harness, and browser fakes.
// Its timings are fixture values, never measurements.

import {
    observationFactory,
    SpeechAdapterError,
    type SpeechAdapter,
    type SpeechCapture,
    type SpeechErrorCode,
    type SpeechObservationV1
} from './speechObservation';

export interface SpeechScript {
    partials?: string[];
    /** Final transcript on stop. Null or blank means nothing was heard. */
    final?: string | null;
    confidence?: number;
    failOnStart?: SpeechErrorCode;
    failOnStop?: SpeechErrorCode;
    /** Also deliver the final through onObservation, as some providers do. */
    echoFinal?: boolean;
}

export interface ScriptedSpeechAdapter extends SpeechAdapter {
    starts: number;
    stops: number;
    cancels: number;
    signals: AbortSignal[];
    sessions: string[];
}

export const SCRIPTED_ADAPTER_ID = 'scripted-speech';

export function scriptedSpeechAdapter(
    script: SpeechScript | (() => SpeechScript),
    options: { now?: () => number } = {}
): ScriptedSpeechAdapter {
    const now = options.now ?? Date.now;
    const adapter: ScriptedSpeechAdapter = {
        id: SCRIPTED_ADAPTER_ID,
        captureKind: 'synthetic',
        starts: 0,
        stops: 0,
        cancels: 0,
        signals: [],
        sessions: [],
        async start(input): Promise<SpeechCapture> {
            const current = typeof script === 'function' ? script() : script;
            adapter.starts += 1;
            adapter.signals.push(input.signal);
            adapter.sessions.push(input.sessionId);
            if (current.failOnStart) throw new SpeechAdapterError(current.failOnStart);
            const provider = { adapterId: SCRIPTED_ADAPTER_ID, providerName: 'Scripted transcript' };
            const observe = observationFactory({
                sessionId: input.sessionId,
                provider,
                locale: input.locale,
                startedAtMs: now(),
                now
            });
            let closed = false;
            for (const partial of current.partials ?? []) {
                input.onObservation(observe({ transcript: partial, final: false }));
            }
            return {
                provider,
                transport: 'synthetic',
                async stop(): Promise<SpeechObservationV1 | null> {
                    adapter.stops += 1;
                    if (closed || input.signal.aborted) return null;
                    closed = true;
                    if (current.failOnStop) throw new SpeechAdapterError(current.failOnStop);
                    const text = current.final ?? '';
                    if (!text.trim()) return null;
                    const final = observe({
                        transcript: text,
                        final: true,
                        endedAtMs: now(),
                        ...(current.confidence !== undefined ? { confidence: current.confidence } : {})
                    });
                    if (current.echoFinal) input.onObservation(final);
                    return final;
                },
                async cancel() {
                    adapter.cancels += 1;
                    closed = true;
                }
            };
        }
    };
    return adapter;
}
