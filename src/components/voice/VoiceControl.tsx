'use client';

import { useEffect, useRef, useState } from 'react';
import { browserDictation, browserVoice, createPushToTalk, type DictationSession, type Voice } from '@/core/interaction/pushToTalk';
import { spatialSession } from '@/core/interaction/session';
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

export function VoiceControl({
    listen = browserDictation,
    voice = browserVoice()
}: {
    listen?: () => DictationSession;
    voice?: Voice;
}) {
    const talk = useRef(createPushToTalk(listen));
    const voiceRef = useRef(voice);
    const pressRef = useRef<() => void>(() => undefined);
    const releaseRef = useRef<() => Promise<void>>(async () => undefined);
    const [held, setHeld] = useState(false);
    const [reply, setReply] = useState('Hold to talk. Click a block, then speak.');

    useEffect(() => {
        voiceRef.current = voice;
    }, [voice]);

    useEffect(() => () => {
        talk.current.cancel();
    }, []);

    function say(text: string) {
        setReply(text);
        voiceRef.current.cancel();
        voiceRef.current.speak(text);
    }

    function press() {
        voiceRef.current.cancel();
        const failed = talk.current.press();
        if (failed?.error) {
            setHeld(false);
            say(failed.error);
            return;
        }
        setHeld(true);
        setReply('Listening');
    }

    async function release() {
        if (!talk.current.held) return;
        setHeld(false);
        const heard = await talk.current.release();
        if (heard.error) {
            say(heard.error);
            return;
        }
        if (!heard.heard) {
            say("I didn't hear anything.");
            return;
        }
        const command = spatialSession.speak(heard.transcript);
        say(command.summary ?? 'Done.');
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
            if (event.code !== 'Space' || !talk.current.held) return;
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
    }, []);

    return (
        <div className="absolute bottom-6 left-4 z-40 w-64 rounded-2xl border border-[var(--citadel-border)] bg-[var(--citadel-surface)]/95 p-3 shadow-xl backdrop-blur-md">
            <p className="mb-2 min-h-8 text-xs text-[var(--text-secondary)]" role="status">{reply}</p>
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
            </div>
        </div>
    );
}
