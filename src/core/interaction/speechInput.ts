// SpeechInputController: capture → final observation → engine admission.
// It holds no authority and never touches canvas stores.

import { createPushToTalk, type PushToTalkOptions } from './pushToTalk';
import type { SpeechTimingRecorder } from './speechMeasurement';
import type { SpeechAdapter, SpeechErrorCode, SpeechObservationV1 } from './speechObservation';
import type { SpatialCommand } from './types';

export interface SpeechAuthority {
    hear(observation: SpeechObservationV1): SpatialCommand;
}

export type SpeechOutcome =
    | { kind: 'command'; command: SpatialCommand; observation: SpeechObservationV1 }
    | { kind: 'silence' }
    | { kind: 'stopped' }
    | { kind: 'error'; code: SpeechErrorCode; message: string };

export interface SpeechInput {
    readonly held: boolean;
    readonly adapterId: string;
    prepare(): Promise<void>;
    press(): Promise<SpeechOutcome | undefined>;
    /** Undefined when nothing was held, so a second release is a no-op. */
    release(): Promise<SpeechOutcome | undefined>;
    cancel(): void;
}

export interface SpeechInputOptions extends PushToTalkOptions {
    adapter: SpeechAdapter;
    authority: SpeechAuthority;
    /** Receives timings from live captures only; synthetic adapters are refused by the recorder. */
    recorder?: SpeechTimingRecorder;
}

const STOP_LISTENING = /^stop listening[.!]?$/i;

export function createSpeechInput(options: SpeechInputOptions): SpeechInput {
    const now = options.now ?? Date.now;
    const talk = createPushToTalk(options.adapter, { ...options, now });

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
            const heard = await talk.release();
            if (heard.error) return { kind: 'error', code: heard.error.code, message: heard.error.message };
            if (!heard.heard || !heard.observation) return { kind: 'silence' };
            if (STOP_LISTENING.test(heard.transcript)) return { kind: 'stopped' };
            const decidedAtMs = now();
            const command = options.authority.hear(heard.observation);
            const admittedAtMs = now();
            if (heard.timings) {
                const { sessionId: _sessionId, ...timings } = heard.timings;
                options.recorder?.record({
                    ...timings,
                    adapterId: heard.observation.provider.adapterId,
                    captureKind: options.adapter.captureKind,
                    decidedAtMs,
                    ...(command.lifecycle === 'committed' ? { committedAtMs: admittedAtMs } : {}),
                    lifecycle: command.lifecycle
                });
            }
            return { kind: 'command', command, observation: heard.observation };
        },
        cancel() {
            talk.cancel();
        }
    };
}
