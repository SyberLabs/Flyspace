'use client';

import { useEffect, useRef, useState } from 'react';
import { browserSpeechAdapter } from '@/core/interaction/browserSpeechAdapter';
import { fallbackSpeechAdapter, openaiRealtimeAdapter } from '@/core/interaction/openaiRealtimeAdapter';
import { spatialSession } from '@/core/interaction/session';
import { browserSpeechFeedback, emitFeedback, silenceFeedback, type SpeechFeedbackAdapter } from '@/core/interaction/speechFeedback';
import { createSpeechInput, type SpeechOutcome } from '@/core/interaction/speechInput';
import { liveSpeechTimings } from '@/core/interaction/speechMeasurement';
import type { SpeechAdapter, SpeechCapture } from '@/core/interaction/speechObservation';
import { useUIStore } from '@/core/stores';

function usesSpace(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.getAttribute('aria-label') === 'Hold to talk') return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') {
        return true;
    }
    if (target.isContentEditable) return true;
    const role = target.getAttribute('role');
    return role === 'button' || role === 'link' || role === 'textbox' || role === 'combobox' || role === 'listbox' || role === 'menuitem';
}

function providerLabel(capture: SpeechCapture): string {
    const name = capture.provider.providerName ?? capture.provider.adapterId;
    if (capture.transport === 'remote') return `${name} (remote)`;
    if (capture.transport === 'browser') return `${name} (browser)`;
    return name;
}

/** Remote transcription when the server says it is configured, the browser recognizer otherwise. */
function defaultSpeechAdapter(): SpeechAdapter {
    return fallbackSpeechAdapter(openaiRealtimeAdapter(), browserSpeechAdapter());
}

function outcomeText(outcome: SpeechOutcome): string {
    if (outcome.kind === 'error') return outcome.message;
    if (outcome.kind === 'silence') return "I didn't hear anything.";
    if (outcome.kind === 'stopped') return 'Stopped listening.';
    return outcome.command.summary ?? 'Done.';
}

export function VoiceControl({
    adapter,
    feedback
}: {
    adapter?: SpeechAdapter;
    /** Spoken replies. `null` turns them off; text replies stay. */
    feedback?: SpeechFeedbackAdapter | null;
}) {
    const [provider, setProvider] = useState<string | null>(null);
    const [input] = useState(() => createSpeechInput({
        adapter: adapter ?? defaultSpeechAdapter(),
        authority: spatialSession,
        recorder: liveSpeechTimings,
        onListening: capture => setProvider(providerLabel(capture))
    }));
    const feedbackRef = useRef<SpeechFeedbackAdapter | null>(feedback === undefined ? browserSpeechFeedback() : feedback);
    const pressRef = useRef<() => void>(() => undefined);
    const releaseRef = useRef<() => Promise<void>>(async () => undefined);
    const [held, setHeld] = useState(false);
    const [spokenReplies, setSpokenReplies] = useState(true);
    const spokenRef = useRef(spokenReplies);
    const [reply, setReply] = useState('Hold to talk. Click a block, then speak.');

    useEffect(() => {
        if (feedback !== undefined) feedbackRef.current = feedback;
    }, [feedback]);

    useEffect(() => {
        spokenRef.current = spokenReplies;
    }, [spokenReplies]);

    useEffect(() => {
        void input.prepare();
        return () => input.cancel();
    }, [input]);

    function say(text: string) {
        setReply(text);
        if (spokenRef.current) emitFeedback(feedbackRef.current, text);
    }

    function press() {
        silenceFeedback(feedbackRef.current);
        setHeld(true);
        setReply('Listening');
        void input.press().then(failed => {
            if (!failed) return;
            setHeld(false);
            setProvider(null);
            say(outcomeText(failed));
        });
    }

    async function release() {
        if (!input.held) return;
        setHeld(false);
        const outcome = await input.release();
        setProvider(null);
        if (outcome) say(outcomeText(outcome));
    }

    useEffect(() => {
        pressRef.current = press;
        releaseRef.current = release;
    });

    useEffect(() => {
        const down = (event: KeyboardEvent) => {
            if (event.code !== 'Space' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
            if (usesSpace(event.target)) return;
            if (useUIStore.getState().commandPaletteOpen) return;
            event.preventDefault();
            pressRef.current();
        };
        const up = (event: KeyboardEvent) => {
            if (event.code !== 'Space' || !input.held) return;
            event.preventDefault();
            void releaseRef.current();
        };
        const interrupt = () => { void releaseRef.current(); };
        const hidden = () => {
            if (document.visibilityState === 'hidden') interrupt();
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        window.addEventListener('blur', interrupt);
        document.addEventListener('visibilitychange', hidden);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
            window.removeEventListener('blur', interrupt);
            document.removeEventListener('visibilitychange', hidden);
        };
    }, [input]);

    return (
        <div className="absolute bottom-6 left-4 z-40 w-64 rounded-2xl border border-[var(--citadel-border)] bg-[var(--citadel-surface)]/95 p-3 shadow-xl backdrop-blur-md">
            <p className="mb-2 min-h-8 text-xs text-[var(--text-secondary)]" role="status">{reply}</p>
            {held && provider && (
                <p className="mb-2 text-[10px] text-[var(--text-muted)]" aria-label="Speech provider">{provider}</p>
            )}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    aria-label="Hold to talk"
                    aria-pressed={held}
                    aria-keyshortcuts="Space"
                    onPointerDown={event => {
                        event.preventDefault();
                        try {
                            event.currentTarget.setPointerCapture(event.pointerId);
                        } catch {
                            // A pointer without an active id still has to start listening.
                        }
                        press();
                    }}
                    onPointerUp={() => { void release(); }}
                    onPointerCancel={() => { void release(); }}
                    onLostPointerCapture={() => { void release(); }}
                    onKeyDown={event => {
                        if (event.code !== 'Space' || event.repeat) return;
                        event.preventDefault();
                        event.stopPropagation();
                        press();
                    }}
                    onKeyUp={event => {
                        if (event.code !== 'Space') return;
                        event.preventDefault();
                        void release();
                    }}
                    className="rounded-full bg-[var(--citadel-primary)] px-3 py-1.5 text-xs font-medium text-white"
                >
                    {held ? 'Listening' : 'Hold to talk'}
                </button>
                <button
                    type="button"
                    aria-label="Spoken replies"
                    aria-pressed={spokenReplies}
                    onClick={() => {
                        if (spokenReplies) silenceFeedback(feedbackRef.current);
                        setSpokenReplies(!spokenReplies);
                    }}
                    className="rounded-full border border-[var(--citadel-border)] px-2 py-1 text-[10px] text-[var(--text-secondary)]"
                >
                    {spokenReplies ? 'Replies on' : 'Replies off'}
                </button>
            </div>
        </div>
    );
}
