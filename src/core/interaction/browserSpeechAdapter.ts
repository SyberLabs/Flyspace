// The one module that touches the browser Web Speech recognizer.
// It is a fallback adapter, not the architecture.

import {
    observationFactory,
    SpeechAdapterError,
    type SpeechAdapter,
    type SpeechAlternative,
    type SpeechCapture,
    type SpeechErrorCode,
    type SpeechObservationV1
} from './speechObservation';

interface RecognitionAlternativeLike {
    transcript: string;
    confidence?: number;
}

interface RecognitionResultEvent {
    results: ArrayLike<{
        [index: number]: RecognitionAlternativeLike | undefined;
        isFinal: boolean;
        length: number;
    }>;
}

export interface RecognitionLike {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: RecognitionResultEvent) => void) | null;
    onerror: ((event: { error: string }) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}

export const BROWSER_ADAPTER_ID = 'browser-web-speech';
const RECOGNITION_WAIT_MS = 2000;

function recognitionFailure(code: string): SpeechErrorCode | null {
    if (code === 'no-speech' || code === 'aborted') return null;
    if (code === 'not-allowed' || code === 'service-not-allowed') return 'permission-denied';
    if (code === 'audio-capture') return 'no-microphone';
    if (code === 'network') return 'network';
    return 'provider-error';
}

function evidence(event: RecognitionResultEvent): { transcript: string; confidence?: number; alternatives?: SpeechAlternative[] } {
    const results = Array.from(event.results);
    const transcript = results.map(result => result[0]?.transcript ?? '').join(' ').trim();
    if (results.length !== 1) return { transcript };
    const only = results[0];
    const top = only[0];
    const confidence = typeof top?.confidence === 'number' && top.confidence > 0 ? top.confidence : undefined;
    const alternatives: SpeechAlternative[] = [];
    for (let index = 1; index < only.length; index += 1) {
        const alternative = only[index];
        if (!alternative) continue;
        alternatives.push(typeof alternative.confidence === 'number'
            ? { transcript: alternative.transcript, confidence: alternative.confidence }
            : { transcript: alternative.transcript });
    }
    return { transcript, confidence, alternatives: alternatives.length ? alternatives : undefined };
}

export function recognizerAdapter(create: () => RecognitionLike, options: { now?: () => number } = {}): SpeechAdapter {
    const now = options.now ?? Date.now;
    return {
        id: BROWSER_ADAPTER_ID,
        captureKind: 'live',
        async start(input): Promise<SpeechCapture> {
            const locale = input.locale ?? 'en-US';
            const startedAtMs = now();
            const provider = { adapterId: BROWSER_ADAPTER_ID, providerName: 'Web Speech API' };
            const observe = observationFactory({
                sessionId: input.sessionId,
                provider,
                locale,
                startedAtMs,
                now
            });
            let latest: ReturnType<typeof evidence> = { transcript: '' };
            let failure: SpeechErrorCode | null = null;
            let closed = false;
            let finish: () => void = () => undefined;
            const ended = new Promise<void>(resolve => { finish = resolve; });

            const recognizer = create();
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = locale;
            recognizer.onresult = event => {
                if (closed) return;
                latest = evidence(event);
                if (latest.transcript) input.onObservation(observe({ ...latest, final: false }));
            };
            recognizer.onerror = event => {
                const code = recognitionFailure(event.error);
                if (!code) return;
                failure = code;
                latest = { transcript: '' };
            };
            recognizer.onend = () => finish();

            const drop = () => {
                if (closed) return;
                closed = true;
                recognizer.abort();
                finish();
            };
            if (input.signal.aborted) throw new SpeechAdapterError('aborted');
            input.signal.addEventListener('abort', drop, { once: true });
            try {
                recognizer.start();
            } catch {
                input.signal.removeEventListener('abort', drop);
                throw new SpeechAdapterError('provider-error');
            }

            return {
                provider,
                transport: 'browser',
                async stop(): Promise<SpeechObservationV1 | null> {
                    if (closed) return null;
                    const endedAtMs = now();
                    recognizer.stop();
                    await Promise.race([ended, new Promise<void>(resolve => setTimeout(resolve, RECOGNITION_WAIT_MS))]);
                    input.signal.removeEventListener('abort', drop);
                    if (closed) return null;
                    closed = true;
                    if (failure) throw new SpeechAdapterError(failure);
                    if (!latest.transcript) return null;
                    return observe({ ...latest, final: true, endedAtMs });
                },
                async cancel() {
                    input.signal.removeEventListener('abort', drop);
                    drop();
                }
            };
        }
    };
}

/** Resolves the recognizer on press, so a server render never decides support. */
export function browserSpeechAdapter(): SpeechAdapter {
    return {
        id: BROWSER_ADAPTER_ID,
        captureKind: 'live',
        start(input) {
            const ctor = typeof window === 'undefined'
                ? undefined
                : window.SpeechRecognition ?? window.webkitSpeechRecognition;
            if (!ctor) return Promise.reject(new SpeechAdapterError('unsupported'));
            return recognizerAdapter(() => new ctor()).start(input);
        }
    };
}

declare global {
    interface Window {
        SpeechRecognition?: new () => RecognitionLike;
        webkitSpeechRecognition?: new () => RecognitionLike;
    }
}
