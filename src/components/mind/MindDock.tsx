'use client';

// ============================================
// PROJECT OMNI: MIND DOCK
// Compact, always-visible Mind interface
// ============================================

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, MessageCircle, Sparkles, ChevronUp, X } from 'lucide-react';
import { useMindStore } from '@/core/stores';
import { getMindEngine } from '@/core/services';
import { cn } from '@/lib/utils';

interface MindDockProps {
    onExpandPanel: () => void;
}

export function MindDock({ onExpandPanel }: MindDockProps) {
    const [isThinking, setIsThinking] = useState(false);
    const [quickChatOpen, setQuickChatOpen] = useState(false);
    const [quickMessage, setQuickMessage] = useState('');
    const [quickResponse, setQuickResponse] = useState<string | null>(null);

    const {
        status,
        personas,
        activePersonaId,
        contextPools
    } = useMindStore();

    const activePersona = personas.find(p => p.id === activePersonaId);

    // Calculate total context entries
    const totalContext = contextPools.reduce((sum, pool) => {
        return sum + pool.entries.length;
    }, 0);

    // Quick Think action
    const handleQuickThink = useCallback(async () => {
        if (isThinking) return;

        setIsThinking(true);
        try {
            const engine = getMindEngine();
            const result = await engine.think();
            if (result.success && result.response) {
                setQuickResponse(result.response.slice(0, 200) + (result.response.length > 200 ? '...' : ''));
                setTimeout(() => setQuickResponse(null), 5000);
            }
        } catch (error) {
            console.error('Quick think error:', error);
        } finally {
            setIsThinking(false);
        }
    }, [isThinking]);

    // Quick Ask action - uses think with a message prefix
    const handleQuickAsk = useCallback(async () => {
        if (!quickMessage.trim() || isThinking) return;

        setIsThinking(true);
        try {
            const engine = getMindEngine();
            // Use think with the user's question as context
            const result = await engine.think(`User asks: ${quickMessage}`);
            if (result.success && result.response) {
                setQuickResponse(result.response.slice(0, 300) + (result.response.length > 300 ? '...' : ''));
                setQuickMessage('');
                setTimeout(() => setQuickResponse(null), 8000);
            }
        } catch (error) {
            console.error('Quick ask error:', error);
        } finally {
            setIsThinking(false);
            setQuickChatOpen(false);
        }
    }, [quickMessage, isThinking]);

    // Keyboard shortcut: M to expand
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'm' && !e.metaKey && !e.ctrlKey && !e.altKey) {
                // Don't trigger if user is typing in an input
                if (document.activeElement?.tagName === 'INPUT' ||
                    document.activeElement?.tagName === 'TEXTAREA') {
                    return;
                }
                onExpandPanel();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onExpandPanel]);

    return (
        <>
            {/* Quick Response Bubble */}
            <AnimatePresence>
                {quickResponse && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        className="absolute bottom-24 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-md z-50"
                        role="status"
                    >
                        <div className="relative bg-[var(--sy-surface-2)] border border-[var(--sy-line)] rounded-lg p-4 pr-14 shadow-[var(--sy-shadow-overlay)]">
                            <div className="flex items-start gap-3">
                                <Brain className="w-5 h-5 flex-none text-[var(--sy-brand)]" strokeWidth={1.5} aria-hidden="true" />
                                <p className="text-sm text-[var(--sy-text)]">
                                    {quickResponse}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setQuickResponse(null)}
                                className="sy-icon-btn absolute top-0 right-0"
                                aria-label="Dismiss answer"
                            >
                                <X />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Quick Chat Input */}
            <AnimatePresence>
                {quickChatOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        className="absolute bottom-24 left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-md z-40"
                    >
                        <div className="bg-[var(--sy-surface)] border border-[var(--sy-line)] rounded-lg p-2 shadow-[var(--sy-shadow-overlay)]">
                            <div className="flex items-center gap-2">
                                <label htmlFor="mind-quick-ask" className="sr-only">Quick question</label>
                                <input
                                    id="mind-quick-ask"
                                    type="text"
                                    value={quickMessage}
                                    onChange={(e) => setQuickMessage(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleQuickAsk()}
                                    placeholder="Ask a quick question"
                                    className="flex-1 h-11 bg-[var(--sy-bg)] border border-[var(--sy-line-strong)] rounded-lg px-4 text-base text-[var(--sy-text)] placeholder:text-[var(--sy-text-3)] focus:outline-none focus:border-[var(--sy-brand)]"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={handleQuickAsk}
                                    disabled={isThinking || !quickMessage.trim()}
                                    aria-busy={isThinking}
                                    className="btn btn-primary"
                                >
                                    Ask
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Dock */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[calc(100%-32px)]">
                <div className="flex items-center gap-1 p-1 bg-[var(--sy-surface)] border border-[var(--sy-line)] rounded-lg shadow-[var(--sy-shadow-overlay)]">
                    {/* Persona */}
                    <button
                        type="button"
                        onClick={onExpandPanel}
                        className="flex items-center gap-3 h-11 pl-3 pr-2 rounded-lg hover:bg-[var(--sy-surface-2)] transition-colors group min-w-0"
                        title="Open Mind Panel (M)"
                    >
                        <Brain className={cn('w-5 h-5 flex-none text-[var(--sy-text-2)]', isThinking && 'animate-pulse')} strokeWidth={1.5} aria-hidden="true" />
                        <span className="text-left min-w-0">
                            <span className="block text-sm font-medium text-[var(--sy-text)] truncate">
                                {activePersona?.name || 'Mind'}
                            </span>
                            <span className="flex items-center gap-1.5 text-xs text-[var(--sy-text-3)] whitespace-nowrap">
                                <span className={cn(
                                    'w-2 h-2 rounded-full flex-none',
                                    status === 'ready' ? 'bg-[var(--sy-success)]' :
                                        status === 'processing' ? 'bg-[var(--sy-warning)] animate-pulse' :
                                            'border border-[var(--sy-text-3)]'
                                )} aria-hidden="true" />
                                {status === 'processing' ? 'Thinking' : status === 'ready' ? `Ready · ${totalContext} sources` : `${totalContext} sources`}
                            </span>
                        </span>
                        <ChevronUp className="w-4 h-4 text-[var(--sy-text-3)] group-hover:text-[var(--sy-text)] transition-colors" aria-hidden="true" />
                    </button>

                    <div className="w-px h-8 bg-[var(--sy-line)]" aria-hidden="true" />

                    <button
                        type="button"
                        onClick={handleQuickThink}
                        disabled={isThinking}
                        aria-busy={isThinking}
                        className="sy-icon-btn disabled:opacity-40"
                        title="Think (analyze context)"
                        aria-label="Think about the wired context"
                    >
                        <Sparkles />
                    </button>

                    <button
                        type="button"
                        onClick={() => setQuickChatOpen(!quickChatOpen)}
                        className="sy-icon-btn"
                        aria-expanded={quickChatOpen}
                        title="Quick Ask"
                        aria-label="Quick ask"
                    >
                        <MessageCircle />
                    </button>
                </div>
            </div>
        </>
    );
}

export default MindDock;
