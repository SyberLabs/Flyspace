// Built-in speech capability. Speak and Listen are local handlers on the
// same manifest gate as OpenAPI — manual invocation, no secret, no network.
// The browser engine is replaceable so tests never touch a real microphone.

import { sha256 } from './hash';
import { sealManifest, validateManifest, type CapabilityManifest } from './manifest';
import type { LocalCall } from './execute';

const MAX_UTTERANCE = 5_000;

export interface SpeechSupport {
    speak: boolean;
    listen: boolean;
}

export type SpeechSource = 'on_device' | 'browser_service' | 'remote' | 'unknown';

export type SpeechTerminal = 'final' | 'cancel' | 'timeout' | 'error' | 'unavailable';

/** One moment of speech. Streams replace a single Promise<string>. */
export interface SpeechObservation {
    sessionId: string;
    segmentId: string;
    startedAt: number;
    updatedAt: number;
    endedAt?: number;
    text: string;
    final: boolean;
    confidence?: number;
    language?: string;
    source: SpeechSource;
    terminal?: SpeechTerminal;
}

export interface SpeechSession {
    id: string;
    signal: AbortSignal;
    cancel: () => void;
}

export interface SpeechEngine {
    supported(): SpeechSupport;
    locality?(): { speak: SpeechSource; listen: SpeechSource };
    speak(text: string, session?: SpeechSession): Promise<void>;
    listen(lang?: string, session?: SpeechSession, onObservation?: (observation: SpeechObservation) => void): Promise<string>;
}

const sessions = new Map<string, AbortController>();
const observationLog = new Map<string, SpeechObservation[]>();
let activeSpeakId: string | null = null;

export function openSpeechSession(kind: 'speak' | 'listen'): SpeechSession {
    const id = `${kind}_${sha256(`${Date.now()}|${Math.random()}`).slice(0, 12)}`;
    const controller = new AbortController();
    sessions.set(id, controller);
    observationLog.set(id, []);
    return {
        id,
        signal: controller.signal,
        cancel() {
            controller.abort();
            if (activeSpeakId === id) {
                activeSpeakId = null;
                if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
            }
        }
    };
}

export function speechObservations(sessionId: string): SpeechObservation[] {
    return observationLog.get(sessionId) ?? [];
}

export function recordSpeechObservation(observation: SpeechObservation): void {
    const list = observationLog.get(observation.sessionId) ?? [];
    list.push(observation);
    observationLog.set(observation.sessionId, list);
}

function speechSource(kind: 'speak' | 'listen'): SpeechSource {
    return getSpeechEngine().locality?.()?.[kind] ?? 'unknown';
}

let engineOverride: SpeechEngine | null = null;

export function setSpeechEngine(engine: SpeechEngine | null): void {
    engineOverride = engine;
}

export function getSpeechEngine(): SpeechEngine {
    return engineOverride ?? browserSpeechEngine;
}

export function speechManifests(): CapabilityManifest[] {
    return [speakManifest(), listenManifest()].flatMap(manifest => {
        const validated = validateManifest(manifest);
        return validated.ok && validated.manifest ? [validated.manifest] : [];
    });
}

export async function runSpeechHandler(
    handler: string,
    args: Record<string, unknown>,
    call?: LocalCall
): Promise<unknown> {
    if (handler === 'speech.speak') {
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) throw new Error('Nothing to speak');
        if (text.length > MAX_UTTERANCE) throw new Error('Utterance exceeds 5000 characters');
        const session = openSpeechSession('speak');
        if (call?.signal) call.signal.addEventListener('abort', () => session.cancel(), { once: true });
        activeSpeakId = session.id;
        try {
            await getSpeechEngine().speak(text, session);
        } finally {
            if (activeSpeakId === session.id) activeSpeakId = null;
        }
        const observation: SpeechObservation = {
            sessionId: session.id,
            segmentId: `${session.id}:0`,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            endedAt: Date.now(),
            text,
            final: true,
            source: speechSource('speak'),
            terminal: session.signal.aborted ? 'cancel' : 'final'
        };
        recordSpeechObservation(observation);
        if (session.signal.aborted) throw new DOMException('Speech canceled', 'AbortError');
        return { spoken: text, source: observation.source, sessionId: session.id };
    }
    if (handler === 'speech.listen') {
        const lang = typeof args.lang === 'string' && args.lang.trim() ? args.lang.trim() : undefined;
        const session = openSpeechSession('listen');
        if (call?.signal) call.signal.addEventListener('abort', () => session.cancel(), { once: true });
        const startedAt = Date.now();
        const transcript = (await getSpeechEngine().listen(lang, session, recordSpeechObservation)).trim();
        if (session.signal.aborted) throw new DOMException('Speech canceled', 'AbortError');
        if (!transcript) throw new Error('No speech recognized');
        const observation: SpeechObservation = {
            sessionId: session.id,
            segmentId: `${session.id}:final`,
            startedAt,
            updatedAt: Date.now(),
            endedAt: Date.now(),
            text: transcript,
            final: true,
            language: lang,
            source: speechSource('listen'),
            terminal: 'final'
        };
        recordSpeechObservation(observation);
        return { transcript, source: observation.source, sessionId: session.id };
    }
    throw new Error(`Unknown speech handler ${handler}`);
}

function speakManifest(): CapabilityManifest {
    return sealManifest({
        version: 1,
        id: 'cap_speech_speak',
        title: 'Speak',
        description: 'Speak text aloud. Wired text is read when the field is empty.',
        source: { kind: 'bring', locator: 'speech', operationId: 'speak' },
        effect: 'compute',
        effectSource: 'declared',
        approval: 'auto',
        invocation: 'manual',
        auth: { kind: 'none' },
        transport: { kind: 'local', handler: 'speech.speak' },
        inputs: [{
            name: 'text',
            in: 'argument',
            required: true,
            schema: { kind: 'string' }
        }],
        output: {
            schema: {
                kind: 'object',
                required: ['spoken'],
                properties: { spoken: { kind: 'string' } }
            },
            presentation: 'items',
            titlePath: 'spoken'
        }
    });
}

function listenManifest(): CapabilityManifest {
    return sealManifest({
        version: 1,
        id: 'cap_speech_listen',
        title: 'Listen',
        description: 'Transcribe microphone speech into text that other blocks can wire.',
        source: { kind: 'bring', locator: 'speech', operationId: 'listen' },
        effect: 'read',
        effectSource: 'declared',
        approval: 'auto',
        invocation: 'manual',
        auth: { kind: 'none' },
        transport: { kind: 'local', handler: 'speech.listen' },
        inputs: [{
            name: 'lang',
            in: 'argument',
            required: false,
            schema: { kind: 'string' }
        }],
        output: {
            schema: {
                kind: 'object',
                required: ['transcript'],
                properties: { transcript: { kind: 'string' } }
            },
            presentation: 'items',
            titlePath: 'transcript'
        }
    });
}

const browserSpeechEngine: SpeechEngine = {
    supported() {
        if (typeof window === 'undefined') return { speak: false, listen: false };
        const recognition = speechRecognitionCtor();
        const voices = window.speechSynthesis?.getVoices() ?? [];
        return {
            speak: voices.length > 0,
            listen: typeof recognition === 'function'
        };
    },

    locality() {
        return {
            speak: 'unknown' as const,
            listen: 'unknown' as const
        };
    },

    async speak(text: string, session?: SpeechSession) {
        if (typeof window === 'undefined' || !window.speechSynthesis) {
            return Promise.reject(new Error('Speech synthesis is not available in this browser'));
        }
        const synth = window.speechSynthesis;
        const voices = await whenVoices(synth);
        if (voices.length === 0) {
            return Promise.reject(new Error('Speech synthesis is not available in this browser'));
        }
        return new Promise((resolve, reject) => {
            let settled = false;
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                fn();
            };
            const timer = window.setTimeout(() => {
                window.speechSynthesis.cancel();
                finish(() => reject(new Error('Speech synthesis timed out')));
            }, 60_000);
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.onend = () => finish(() => resolve());
            utterance.onerror = (event: Event) => {
                const reason = 'error' in event && typeof event.error === 'string' ? event.error : 'failed';
                const message = reason === 'canceled' || reason === 'interrupted'
                    ? 'Speech synthesis was interrupted'
                    : `Speech synthesis failed (${reason})`;
                finish(() => reject(new Error(message)));
            };
            // Chrome cancels an utterance spoken in the same turn as cancel().
            if (session?.signal.aborted) {
                finish(() => reject(new DOMException('Speech canceled', 'AbortError')));
                return;
            }
            session?.signal.addEventListener('abort', () => {
                if (activeSpeakId === session.id) synth.cancel();
                finish(() => reject(new DOMException('Speech canceled', 'AbortError')));
            }, { once: true });
            if (synth.speaking || synth.pending) synth.cancel();
            window.setTimeout(() => {
                if (settled || session?.signal.aborted) return;
                synth.speak(utterance);
            }, 50);
        });
    },

    listen(lang?: string, session?: SpeechSession, onObservation?: (observation: SpeechObservation) => void) {
        const Ctor = speechRecognitionCtor();
        if (!Ctor) return Promise.reject(new Error('Speech recognition is not available in this browser'));
        return new Promise((resolve, reject) => {
            const recognition = new Ctor();
            const startedAt = Date.now();
            let settled = false;
            const finish = (fn: () => void) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                try {
                    recognition.stop();
                } catch {
                    // The session may already have ended.
                }
                fn();
            };
            session?.signal.addEventListener('abort', () => {
                finish(() => reject(new DOMException('Speech canceled', 'AbortError')));
            }, { once: true });
            const timer = window.setTimeout(() => {
                finish(() => reject(new Error('Speech recognition timed out')));
            }, 15_000);
            recognition.lang = lang || 'en-US';
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            recognition.onresult = (event: SpeechRecognitionEventLike) => {
                const list = event.results;
                const latest = list && list.length > 0 ? list[list.length - 1] : undefined;
                const transcript = latest?.[0]?.transcript ?? '';
                const isFinal = latest?.isFinal === true;
                if (session && transcript) {
                    onObservation?.({
                        sessionId: session.id,
                        segmentId: `${session.id}:${isFinal ? 'final' : 'interim'}`,
                        startedAt,
                        updatedAt: Date.now(),
                        endedAt: isFinal ? Date.now() : undefined,
                        text: transcript,
                        final: isFinal,
                        language: lang,
                        source: 'unknown'
                    });
                }
                if (isFinal) finish(() => resolve(transcript));
            };
            recognition.onerror = (event: { error?: string }) => {
                const code = event.error || 'failed';
                if (session) {
                    onObservation?.({
                        sessionId: session.id,
                        segmentId: `${session.id}:error`,
                        startedAt,
                        updatedAt: Date.now(),
                        endedAt: Date.now(),
                        text: '',
                        final: true,
                        language: lang,
                        source: 'unknown',
                        terminal: 'error'
                    });
                }
                if (code === 'aborted') {
                    finish(() => reject(new DOMException('Speech canceled', 'AbortError')));
                    return;
                }
                finish(() => reject(new Error(speechRecognitionMessage(code))));
            };
            recognition.onend = () => finish(() => reject(new Error('No speech recognized')));
            recognition.start();
        });
    }
};

export function speechRecognitionMessage(code: string): string {
    if (code === 'not-allowed' || code === 'service-not-allowed') return 'Permission denied';
    if (code === 'audio-capture') return 'No microphone is available';
    if (code === 'network') return 'Speech recognition service is unreachable';
    if (code === 'aborted') return 'Speech canceled';
    return `Speech recognition failed (${code})`;
}

interface SpeechRecognitionAlternative {
    transcript?: string;
}

interface SpeechRecognitionResultLike {
    isFinal?: boolean;
    0?: SpeechRecognitionAlternative;
    [index: number]: SpeechRecognitionAlternative | undefined;
}

interface SpeechRecognitionEventLike {
    results?: ArrayLike<SpeechRecognitionResultLike> & { length: number };
}

interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: { error?: string }) => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
}

function whenVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
    if (typeof synth.getVoices !== 'function') return Promise.resolve([]);
    const existing = synth.getVoices();
    if (existing.length > 0) return Promise.resolve(existing);
    return new Promise(resolve => {
        const finish = () => {
            window.clearTimeout(timer);
            synth.removeEventListener('voiceschanged', finish);
            resolve(typeof synth.getVoices === 'function' ? synth.getVoices() : []);
        };
        const timer = window.setTimeout(finish, 300);
        synth.addEventListener('voiceschanged', finish);
        synth.getVoices();
    });
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
    if (typeof window === 'undefined') return undefined;
    const host = window as Window & {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    return host.SpeechRecognition ?? host.webkitSpeechRecognition;
}
