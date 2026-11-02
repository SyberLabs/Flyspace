'use client';

// ============================================
// PROJECT OMNI: LLM STATUS PILL
// Answers "is my LLM reachable?" at a glance in the TopBar — and, since it is
// the only place the provider is ever shown, lets you change it.
//
// The preview has no LLM, so the dot is always red and the hint names what
// would make the selected provider work.
// ============================================

import { useState, useEffect, useRef } from 'react';
import { Brain, Check } from 'lucide-react';
import { useMindStore } from '@/core/stores/mindStore';
import type { LLMProvider } from '@/core/schemas/mind.schema';
import { cn } from '@/lib/utils';
import { useClientMounted } from '@/core/hooks';

const PROVIDERS: { id: LLMProvider; label: string; hint: string }[] = [
    { id: 'local', label: 'Local', hint: 'Ollama on localhost:11434 — no key, nothing leaves the machine' },
    { id: 'anthropic', label: 'Anthropic', hint: 'Claude — needs ANTHROPIC_API_KEY in .env' },
    { id: 'google', label: 'Google', hint: 'Gemini — needs GOOGLE_API_KEY in .env' }
];

export function LlmStatusPill() {
    const llmConfig = useMindStore(state => state.llmConfig);
    const setProvider = useMindStore(state => state.setProvider);
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const hasMounted = useClientMounted();

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

    const hint = llmConfig.provider === 'local'
        ? 'LLM unavailable — start Ollama (localhost:11434)'
        : `LLM unavailable — set the ${llmConfig.provider} API key in .env`;

    return (
        <div className="relative" ref={wrapRef}>
            <button
                onClick={() => setOpen(o => !o)}
                title={`${hint} · click to change provider`}
                data-testid="llm-status-pill"
                aria-haspopup="menu"
                aria-expanded={open}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] hover:border-[var(--citadel-primary)] transition-colors"
            >
                <Brain className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--truth-red)]" />
                <span className="text-[10px] text-[var(--text-muted)]">{llmConfig.provider}</span>
            </button>

            {open && (
                <div
                    role="menu"
                    className="absolute right-0 top-full mt-1.5 w-60 z-50 rounded-lg border border-[var(--citadel-border)] bg-[var(--citadel-surface)] shadow-xl overflow-hidden"
                >
                    <p className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
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
                                    'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors',
                                    active
                                        ? 'bg-[var(--citadel-primary)]/10'
                                        : 'hover:bg-[var(--citadel-elevated)]'
                                )}
                            >
                                <Check
                                    className={cn(
                                        'w-3 h-3 mt-0.5 flex-shrink-0',
                                        active ? 'text-[var(--citadel-primary-glow)]' : 'opacity-0'
                                    )}
                                />
                                <span className="min-w-0">
                                    <span className="block text-xs text-[var(--text-primary)]">{p.label}</span>
                                    <span className="block text-[10px] text-[var(--text-muted)] leading-snug">
                                        {p.hint}
                                    </span>
                                </span>
                            </button>
                        );
                    })}

                    <div className="border-t border-[var(--citadel-border)] px-3 py-2">
                        <span className="block text-[10px] text-[var(--text-muted)] truncate" title={hint}>
                            {hint}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}
