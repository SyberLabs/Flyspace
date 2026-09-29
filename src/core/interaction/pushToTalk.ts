export interface DictationSession {
    start(): void;
    stop(): Promise<string>;
    abort(): void;
    readonly error?: string;
}

export interface Voice {
    speak(text: string): void;
    cancel(): void;
}

export interface Heard {
    transcript: string;
    heard: boolean;
    error?: string;
}

export interface PushToTalk {
    readonly held: boolean;
    press(): Heard | undefined;
    release(): Promise<Heard>;
    /** Drop the microphone without turning the audio into a command. */
    cancel(): void;
}

export function createPushToTalk(listen: () => DictationSession): PushToTalk {
    let session: DictationSession | null = null;
    let held = false;

    return {
        get held() {
            return held;
        },
        press() {
            if (held) return undefined;
            const next = listen();
            try {
                next.start();
            } catch (error) {
                held = false;
                session = null;
                return {
                    transcript: '',
                    heard: false,
                    error: error instanceof Error ? error.message : 'Speech recognition failed.'
                };
            }
            session = next;
            held = true;
            return undefined;
        },
        async release() {
            if (!held || !session) return { transcript: '', heard: false };
            held = false;
            const current = session;
            session = null;
            const transcript = (await current.stop()).trim();
            if (!transcript && current.error) {
                return { transcript: '', heard: false, error: current.error };
            }
            return { transcript, heard: transcript.length > 0 };
        },
        cancel() {
            held = false;
            const current = session;
            session = null;
            current?.abort();
        }
    };
}

export interface RecognitionResultEvent {
    results: ArrayLike<{
        0: { transcript: string };
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

const RECOGNITION_WAIT_MS = 2000;

function recognitionFailure(code: string): string | null {
    if (code === 'no-speech' || code === 'aborted') return null;
    if (code === 'not-allowed' || code === 'service-not-allowed') return 'Microphone permission was refused.';
    if (code === 'audio-capture') return 'No microphone is available.';
    if (code === 'network') return 'Speech recognition needs a network connection.';
    return 'Speech recognition failed.';
}

export function dictationFromRecognizer(create: () => RecognitionLike): DictationSession {
    let recognizer: RecognitionLike | null = null;
    let transcript = '';
    let failure = '';
    let finished: Promise<string> | null = null;
    let finish: ((text: string) => void) | null = null;

    return {
        get error() {
            return failure || undefined;
        },
        start() {
            transcript = '';
            failure = '';
            finished = new Promise(resolve => {
                finish = resolve;
            });
            recognizer = create();
            recognizer.continuous = true;
            recognizer.interimResults = true;
            recognizer.lang = 'en-US';
            recognizer.onresult = event => {
                transcript = Array.from(event.results)
                    .map(result => result[0]?.transcript ?? '')
                    .join(' ')
                    .trim();
            };
            recognizer.onerror = event => {
                const message = recognitionFailure(event.error);
                if (!message) return;
                failure = message;
                transcript = '';
            };
            recognizer.onend = () => finish?.(transcript);
            recognizer.start();
        },
        stop() {
            recognizer?.stop();
            const pending = finished ?? Promise.resolve(transcript);
            return new Promise(resolve => {
                const timer = setTimeout(() => resolve(transcript), RECOGNITION_WAIT_MS);
                pending.then(text => {
                    clearTimeout(timer);
                    resolve(text);
                });
            });
        },
        abort() {
            recognizer?.abort();
            finish?.(transcript);
        }
    };
}

export function browserDictation(): DictationSession {
    const ctor = typeof window === 'undefined'
        ? undefined
        : window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!ctor) {
        return {
            start() {
                throw new Error('This browser has no speech recognition.');
            },
            stop() {
                return Promise.resolve('');
            },
            abort() {}
        };
    }
    return dictationFromRecognizer(() => new ctor());
}

export function browserVoice(): Voice {
    const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
    return {
        speak(text: string) {
            if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
            synth.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'en-US';
            synth.speak(utterance);
        },
        cancel() {
            synth?.cancel();
        }
    };
}

declare global {
    interface Window {
        SpeechRecognition?: new () => RecognitionLike;
        webkitSpeechRecognition?: new () => RecognitionLike;
    }
}
