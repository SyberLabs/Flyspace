// SpeechInputController: capture → final observation → compile → engine admission.
// It holds no authority and never touches canvas stores.

import { createIntentCompiler, type IntentCompiler, type IntentCompilerResult, type IntentContext } from './intentCompiler';
import { createPushToTalk, type PushToTalkOptions } from './pushToTalk';
import type { SpeechAdapter, SpeechErrorCode, SpeechObservationV1 } from './speechObservation';
import type { SpatialCommand } from './types';

export interface SpeechAuthority {
    describeSpeechContext(): IntentContext;
    admitSpeech(observation: SpeechObservationV1, result: IntentCompilerResult): SpatialCommand;
}

export type SpeechOutcome =
    | { kind: 'command'; command: SpatialCommand; observation: SpeechObservationV1 }
    | { kind: 'silence' }
    | { kind: 'stopped' }
    | { kind: 'cancelled' }
    | { kind: 'error'; code: SpeechErrorCode; message: string };

interface SpeechInput {
    readonly held: boolean;
    readonly adapterId: string;
    prepare(): Promise<void>;
    press(): Promise<SpeechOutcome | undefined>;
    /** Undefined when nothing was held, so a second release is a no-op. */
    release(): Promise<SpeechOutcome | undefined>;
    cancel(): void;
}

interface SpeechInputOptions extends PushToTalkOptions {
    adapter: SpeechAdapter;
    authority: SpeechAuthority;
    /** Defaults to the fixed grammar alone. */
    compiler?: IntentCompiler;
}

const STOP_LISTENING = /^stop listening[.!]?$/i;

export function createSpeechInput(options: SpeechInputOptions): SpeechInput {
    const talk = createPushToTalk(options.adapter, options);
    const compiler = options.compiler ?? createIntentCompiler();
    let generation = 0;

    return {
        get held() {
            return talk.held;
        },
        get adapterId() {
            return talk.adapterId;
        },
        async prepare() {
            try {
                await options.adapter.prepare?.();
            } catch {
                // A failed probe leaves the adapter to decide at press time.
            }
        },
        async press() {
            const failed = await talk.press();
            if (!failed?.error) return undefined;
            return { kind: 'error', code: failed.error.code, message: failed.error.message };
        },
        async release() {
            if (!talk.held) return undefined;
            const turn = generation;
            const heard = await talk.release();
            if (heard.error) return { kind: 'error', code: heard.error.code, message: heard.error.message };
            if (!heard.heard || !heard.observation) return { kind: 'silence' };
            if (STOP_LISTENING.test(heard.transcript)) return { kind: 'stopped' };
            const result = await compiler.compile(heard.observation, options.authority.describeSpeechContext());
            if (turn !== generation) return { kind: 'cancelled' };
            const command = options.authority.admitSpeech(heard.observation, result);
            return { kind: 'command', command, observation: heard.observation };
        },
        cancel() {
            generation += 1;
            talk.cancel();
        }
    };
}
