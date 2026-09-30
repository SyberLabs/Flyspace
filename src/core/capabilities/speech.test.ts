import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { blockRegistry } from '../registry/BlockRegistry';
import {
    clearCapabilities,
    ensureSpeechCapabilities,
    getCapability,
    uninstallCapability
} from './registry';
import { executeCapability, unbindLocalHandler } from './execute';
import { setSpeechEngine, speechRecognitionMessage, type SpeechEngine } from './speech';

function fakeEngine(transcript = 'hello there'): SpeechEngine & { spoken: string[]; langs: Array<string | undefined> } {
    const spoken: string[] = [];
    const langs: Array<string | undefined> = [];
    return {
        spoken,
        langs,
        supported: () => ({ speak: true, listen: true }),
        speak: async (text: string) => {
            spoken.push(text);
        },
        listen: async (lang?: string) => {
            langs.push(lang);
            return transcript;
        }
    };
}

beforeEach(() => {
    clearCapabilities();
    setSpeechEngine(fakeEngine());
    ensureSpeechCapabilities();
});

afterEach(() => {
    setSpeechEngine(null);
    clearCapabilities();
});

describe('speech capabilities', () => {
    it('installs manual local speak and listen without secrets', () => {
        const speak = getCapability('cap_speech_speak');
        const listen = getCapability('cap_speech_listen');
        expect(speak?.transport).toEqual({ kind: 'local', handler: 'speech.speak' });
        expect(speak?.invocation).toBe('manual');
        expect(speak?.effect).toBe('compute');
        expect(speak?.approval).toBe('auto');
        expect(speak?.auth).toEqual({ kind: 'none' });
        expect(listen?.effect).toBe('read');
        expect(listen?.invocation).toBe('manual');
        expect(blockRegistry.get('cap_speech_speak')?.icon).toBe('Volume2');
        expect(blockRegistry.get('cap_speech_listen')?.icon).toBe('Mic');
        expect(blockRegistry.get('cap_speech_speak')?.ports?.find(port => port.id === 'in')?.schema?.kind).toBe('object');
    });

    it('speaks text and returns a typed spoken string', async () => {
        const engine = fakeEngine();
        setSpeechEngine(engine);
        const result = await executeCapability('cap_speech_speak', { text: '  board is quiet  ' });
        expect(result.ok).toBe(true);
        expect(engine.spoken).toEqual(['board is quiet']);
        expect(result.typed?.value).toMatchObject({ spoken: 'board is quiet', source: 'unknown' });
        expect(result.presentation.items?.[0]?.title).toBe('board is quiet');
        expect(result.presentation.items?.[0]?.title).not.toContain('typed');
    });

    it('refuses empty text and an unbound handler', async () => {
        const missing = await executeCapability('cap_speech_speak', {});
        expect(missing.error?.code).toBe('INPUT_INVALID');

        const empty = await executeCapability('cap_speech_speak', { text: '   ' });
        expect(empty.ok).toBe(false);
        expect(empty.error?.code).toBe('UPSTREAM_ERROR');
        expect(empty.error?.message).toBe('Nothing to speak');

        unbindLocalHandler('speech.speak');
        const unbound = await executeCapability('cap_speech_speak', { text: 'hi' });
        expect(unbound.error?.code).toBe('TRANSPORT_NOT_BOUND');
    });

    it('returns a transcript and surfaces a silent recognition', async () => {
        const engine = fakeEngine('  noted  ');
        setSpeechEngine(engine);
        const heard = await executeCapability('cap_speech_listen', { lang: 'en-GB' });
        expect(heard.ok).toBe(true);
        expect(engine.langs).toEqual(['en-GB']);
        expect(heard.typed?.value).toMatchObject({ transcript: 'noted', source: 'unknown' });
        expect(heard.presentation.items?.[0]?.title).toBe('noted');

        setSpeechEngine(fakeEngine('   '));
        const silent = await executeCapability('cap_speech_listen', {});
        expect(silent.error?.code).toBe('UPSTREAM_ERROR');
        expect(silent.error?.message).toBe('No speech recognized');
    });

    it('names a denied microphone as permission denied', () => {
        expect(speechRecognitionMessage('not-allowed')).toBe('Permission denied');
        expect(speechRecognitionMessage('service-not-allowed')).toBe('Permission denied');
        expect(speechRecognitionMessage('network')).toBe('Speech recognition service is unreachable');
    });

    it('brings builtins back after they are cleared', () => {
        expect(uninstallCapability('cap_speech_speak')).toBe(true);
        expect(getCapability('cap_speech_speak')).toBeUndefined();
        ensureSpeechCapabilities();
        expect(getCapability('cap_speech_speak')?.id).toBe('cap_speech_speak');
        expect(blockRegistry.has('polymarket_live_odds')).toBe(true);
    });
});
