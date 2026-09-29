'use client';

import { useEffect, useState } from 'react';
import { useBlockStore } from '@/core/stores';
import {
    getSpeechEngine,
    resolveWiredInputs,
    runInstalledCapability,
    useCapabilityStore,
    type SpeechSupport
} from '@/core/capabilities';

function readField(data: unknown, field: 'spoken' | 'transcript'): string {
    if (!data || typeof data !== 'object' || !('typed' in data)) return '';
    const typed = (data as { typed?: { value?: unknown } | null }).typed;
    const value = typed?.value;
    if (!value || typeof value !== 'object' || !(field in value)) return '';
    const text = (value as Record<string, unknown>)[field];
    return typeof text === 'string' ? text : '';
}

/**
 * Speak reads wired text (or the field) aloud.
 * Listen transcribes the microphone into a typed string other blocks can wire.
 * Neither runs just because the block was placed.
 */
export function SpeechBlockView({ instanceId }: { instanceId: string }) {
    const block = useBlockStore(state => state.getBlock(instanceId));
    const capabilityId = block?.schema.capabilityId ?? '';
    const manifest = useCapabilityStore(state => state.manifests.find(entry => entry.id === capabilityId));
    const listening = capabilityId === 'cap_speech_listen';
    const [support, setSupport] = useState<SpeechSupport>(() => getSpeechEngine().supported());
    useEffect(() => {
        const synth = typeof window === 'undefined' ? undefined : window.speechSynthesis;
        if (!synth || typeof synth.addEventListener !== 'function') return;
        const refresh = () => setSupport(getSpeechEngine().supported());
        synth.addEventListener('voiceschanged', refresh);
        synth.getVoices?.();
        return () => synth.removeEventListener('voiceschanged', refresh);
    }, []);
    const available = listening ? support.listen : support.speak;
    const wired = resolveWiredInputs(instanceId).text;
    const wiredText = typeof wired === 'string' ? wired : '';
    const [draft, setDraft] = useState('');
    const [running, setRunning] = useState(false);

    const spoken = readField(block?.data, 'spoken');
    const transcript = readField(block?.data, 'transcript');

    const run = () => {
        if (!manifest || running || !available) return;
        const text = (draft.trim() || wiredText).trim();
        setRunning(true);
        const input = listening ? {} : { text };
        void runInstalledCapability(instanceId, input).finally(() => setRunning(false));
    };

    return (
        <div className="flex h-full flex-col gap-2 p-3 text-sm text-[var(--text-primary)]">
            <div className="text-xs text-[var(--text-muted)]">
                {listening ? 'Listen' : 'Speak'} · {available ? 'ready' : 'unavailable'}
            </div>
            {!available ? (
                <p className="text-xs text-[var(--truth-red)]">
                    {listening
                        ? 'This browser has no speech recognition.'
                        : 'This browser has no speech synthesis.'}
                </p>
            ) : null}
            {listening ? (
                <p className="min-h-0 flex-1 overflow-auto text-sm">
                    {transcript || 'No transcript yet.'}
                </p>
            ) : (
                <textarea
                    aria-label="Text to speak"
                    value={draft}
                    placeholder={wiredText || 'Text to speak'}
                    onChange={event => setDraft(event.target.value)}
                    disabled={!available}
                    className="min-h-0 flex-1 resize-none rounded border border-[var(--citadel-border)] bg-transparent p-2 text-sm"
                />
            )}
            {available && block?.error ? <p className="text-xs text-[var(--truth-red)]">{block.error}</p> : null}
            {!listening && spoken ? <p className="truncate text-xs text-[var(--text-muted)]">Spoke: {spoken}</p> : null}
            <button
                type="button"
                onClick={run}
                disabled={!manifest || running || !available || (!listening && !(draft.trim() || wiredText.trim()))}
                className="rounded border border-[var(--citadel-border)] px-2 py-1 text-xs disabled:opacity-50"
            >
                {running ? 'Running…' : listening ? 'Listen' : 'Speak'}
            </button>
        </div>
    );
}
