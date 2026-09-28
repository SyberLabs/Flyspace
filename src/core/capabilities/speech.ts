// Built-in speech capability. Speak and Listen are local handlers on the
// same manifest gate as OpenAPI — manual invocation, no secret, no network.
// The browser engine is replaceable so tests never touch a real microphone.

import { sealManifest, validateManifest, type CapabilityManifest } from './manifest';

const MAX_UTTERANCE = 5_000;

export interface SpeechSupport {
    speak: boolean;
    listen: boolean;
}

export interface SpeechEngine {
    supported(): SpeechSupport;
    speak(text: string): Promise<void>;
    listen(lang?: string): Promise<string>;
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

export async function runSpeechHandler(handler: string, args: Record<string, unknown>): Promise<unknown> {
    if (handler === 'speech.speak') {
        const text = typeof args.text === 'string' ? args.text.trim() : '';
        if (!text) throw new Error('Nothing to speak');
        if (text.length > MAX_UTTERANCE) throw new Error('Utterance exceeds 5000 characters');
        await getSpeechEngine().speak(text);
        return { spoken: text };
    }
    if (handler === 'speech.listen') {
        const lang = typeof args.lang === 'string' && args.lang.trim() ? args.lang.trim() : undefined;
        const transcript = (await getSpeechEngine().listen(lang)).trim();
        if (!transcript) throw new Error('No speech recognized');
        return { transcript };
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

    async speak(text: string) {
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
            if (synth.speaking || synth.pending) synth.cancel();
            window.setTimeout(() => {
                if (settled) return;
                synth.speak(utterance);
            }, 50);
        });
    },

    listen(lang?: string) {
        const Ctor = speechRecognitionCtor();
        if (!Ctor) return Promise.reject(new Error('Speech recognition is not available in this browser'));
        return new Promise((resolve, reject) => {
            const recognition = new Ctor();
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
            const timer = window.setTimeout(() => {
                finish(() => reject(new Error('Speech recognition timed out')));
            }, 15_000);
            recognition.lang = lang || 'en-US';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;
            recognition.onresult = (event: SpeechRecognitionEventLike) => {
                const transcript = event.results?.[0]?.[0]?.transcript ?? '';
                finish(() => resolve(transcript));
            };
            recognition.onerror = (event: { error?: string }) => {
                finish(() => reject(new Error(event.error || 'Speech recognition failed')));
            };
            recognition.onend = () => finish(() => reject(new Error('No speech recognized')));
            recognition.start();
        });
    }
};

interface SpeechRecognitionEventLike {
    results?: Array<Array<{ transcript?: string }>>;
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
