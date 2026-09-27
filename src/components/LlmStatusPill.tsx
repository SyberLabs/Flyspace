'use client';

// ============================================
// PROJECT OMNI: LLM STATUS PILL
// Answers "is my LLM reachable?" at a glance in the TopBar — and, since it is
// the only place the provider is ever shown, lets you change it.
//
// It used to display the provider name on a hover-styled button whose click
// merely re-pinged. It read as a selector and behaved as a refresh, so the
// provider looked stuck: the real switch was buried in Mind → Settings.
//
// Availability uses /api/llm mode:'ping' — key presence for cloud, a live
// Ollama ping for local. No generation, no keys in the browser.
// ============================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { Brain, Check, RefreshCw } from 'lucide-react';
import { useMindStore } from '@/core/stores/mindStore';
import type { LLMProvider } from '@/core/schemas/mind.schema';
import { cn } from '@/lib/utils';
import { useClientMounted } from '@/core/hooks';

type PillStatus = 'checking' | 'available' | 'unavailable';

async function pingLlm(provider: LLMProvider, baseUrl?: string): Promise<boolean> {
    const res = await fetch('/api/llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'ping', provider, baseUrl })
    });
    const data = res.ok ? await res.json() : { available: false };
    return data.available === true;
}

const PROVIDERS: { id: LLMProvider; label: string; hint: string }[] = [
    { id: 'local', label: 'Local', hint: 'Ollama on localhost:11434 — no key, nothing leaves the machine' },
    { id: 'anthropic', label: 'Anthropic', hint: 'Claude — needs ANTHROPIC_API_KEY in .env' },
    { id: 'google', label: 'Google', hint: 'Gemini — needs GOOGLE_API_KEY in .env' }
];

export function LlmStatusPill() {
    const llmConfig = useMindStore(state => state.llmConfig);
    const setProvider = useMindStore(state => state.setProvider);
    const [status, setStatus] = useState<PillStatus>('checking');
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const hasMounted = useClientMounted();

    const ping = useCallback(async () => {
        setStatus('checking');
        try {
            setStatus(await pingLlm(llmConfig.provider, llmConfig.baseUrl) ? 'available' : 'unavailable');
        } catch {
            setStatus('unavailable');
        }
    }, [llmConfig.provider, llmConfig.baseUrl]);

    const pingKey = `${llmConfig.provider}|${llmConfig.baseUrl ?? ''}`;
    const [activePingKey, setActivePingKey] = useState(pingKey);
    if (hasMounted && pingKey !== activePingKey) {
        setActivePingKey(pingKey);
        setStatus('checking');
    }

    useEffect(() => {
        if (!hasMounted) return;
        let cancelled = false;
        pingLlm(llmConfig.provider, llmConfig.baseUrl)
            .then((ok) => {
                if (!cancelled) setStatus(ok ? 'available' : 'unavailable');
            })
            .catch(() => {
                if (!cancelled) setStatus('unavailable');
            });
        return () => { cancelled = true; };
    }, [hasMounted, llmConfig.provider, llmConfig.baseUrl]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    if (!hasMounted) return null;

    const hint = status === 'available'
        ? `LLM ready: ${llmConfig.provider} · ${llmConfig.model}`
        : status === 'unavailable'
            ? (llmConfig.provider === 'local'
                ? 'LLM unavailable — start Ollama (localhost:11434)'
                : `LLM unavailable — set the ${llmConfig.provider} API key in .env`)
            : 'Checking LLM availability…';

    return (
        <div className="relative" ref={wrapRef}>
            <button
                onClick={() => setOpen(o => !o)}
                title={`${hint} · click to change provider`}
                data-testid="llm-status-pill"
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex items-center gap-2 h-11 px-3 rounded-lg text-sm text-[var(--sy-text-2)] hover:text-[var(--sy-text)] hover:bg-[var(--sy-surface-2)] transition-colors"
            >
                <Brain className="w-5 h-5 text-[var(--sy-text-3)]" strokeWidth={1.5} aria-hidden="true" />
                <span
                    aria-hidden="true"
                    className={cn(
                        'w-2 h-2 rounded-full',
                        status === 'available' && 'bg-[var(--sy-success)]',
                        status === 'unavailable' && 'bg-[var(--sy-danger)]',
                        status === 'checking' && 'bg-[var(--sy-warning)] animate-pulse'
                    )}
                />
                <span className="font-mono text-xs">{llmConfig.provider}</span>
                <span className="hidden xl:inline text-[var(--sy-text-3)]">
                    {status === 'available' ? 'ready' : status === 'unavailable' ? 'offline' : 'checking'}
                </span>
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full mt-1.5 w-60 z-50 rounded-lg border border-[var(--sy-line)] bg-[var(--sy-surface-2)] shadow-[var(--sy-shadow-overlay)] overflow-hidden"
                >
                    <p className="px-3 pt-3 pb-2 sy-label">
                        Provider
                    </p>

                    {PROVIDERS.map(p => {
                        const active = llmConfig.provider === p.id;
                        return (
                            <button
                                key={p.id}
                                role="menuitem"
                                onClick={() => { setProvider(p.id); setOpen(false); }}
                                title={p.hint}
                                className={cn(
                                    'w-full text-left min-h-11 px-3 py-2 flex items-start gap-2 transition-colors',
                                    active
                                        ? 'bg-[var(--sy-bg)]'
                                        : 'hover:bg-[var(--sy-bg)]'
                                )}
                            >
                                <Check
                                    className={cn(
                                        'w-4 h-4 mt-0.5 flex-shrink-0',
                                        active ? 'text-[var(--sy-brand)]' : 'opacity-0'
                                    )}
                                />
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-[var(--sy-text)]">{p.label}</span>
                                    <span className="block text-xs text-[var(--text-muted)] leading-snug">
                                        {p.hint}
                                    </span>
                                </span>
                            </button>
                        );
                    })}

                    <div className="border-t border-[var(--citadel-border)] px-3 py-2 flex items-center justify-between gap-2">
                        <span className="text-xs text-[var(--text-muted)] truncate" title={hint}>
                            {hint}
                        </span>
                        <button
                            onClick={() => void ping()}
                            title="Re-check availability"
                            aria-label="Re-check availability"
                            className="sy-icon-btn flex-shrink-0"
                        >
                            <RefreshCw className={cn(status === 'checking' && 'animate-spin')} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default LlmStatusPill;
