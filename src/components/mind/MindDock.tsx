'use client';

// ============================================
// PROJECT OMNI: MIND DOCK
// Compact, always-visible Mind interface
// ============================================

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, MessageCircle, Sparkles, ChevronUp, Settings, Zap } from 'lucide-react';
import { useMindStore } from '@/core/stores';
import { getMindEngine } from '@/core/services/mind.engine';
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
            } else if (result.error) {
                setQuickResponse(result.error);
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
            } else if (result.error) {
                setQuickResponse(result.error);
                setTimeout(() => setQuickResponse(null), 5000);
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
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute bottom-20 left-1/2 -translate-x-1/2 max-w-md z-50"
                    >
                        <div className="bg-[var(--citadel-surface)] border border-[var(--mind-aqua-glow)]/30 rounded-xl p-4 shadow-lg backdrop-blur-sm">
                            <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-full bg-[var(--mind-aqua-glow)]/20 flex items-center justify-center flex-shrink-0">
                                    <Brain className="w-4 h-4 text-[var(--mind-aqua-glow)]" />
                                </div>
                                <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                                    {quickResponse}
                                </p>
                            </div>
                            <button
                                onClick={() => setQuickResponse(null)}
                                className="absolute top-2 right-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs"
                            >
                                ✕
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Quick Chat Input */}
            <AnimatePresence>
                {quickChatOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-16 left-1/2 -translate-x-1/2 w-96 z-40"
                    >
                        <div className="bg-[var(--citadel-surface)] border border-[var(--citadel-border)] rounded-xl p-3 shadow-lg">
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={quickMessage}
                                    onChange={(e) => setQuickMessage(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleQuickAsk()}
                                    placeholder="Quick question..."
                                    className="flex-1 bg-[var(--citadel-elevated)] border border-[var(--citadel-border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--mind-aqua-glow)]/50"
                                    autoFocus
                                />
                                <button
                                    onClick={handleQuickAsk}
                                    disabled={isThinking || !quickMessage.trim()}
                                    className="p-2 rounded-lg bg-[var(--mind-aqua-glow)]/20 text-[var(--mind-aqua-glow)] hover:bg-[var(--mind-aqua-glow)]/30 disabled:opacity-50 transition-colors"
                                >
                                    <Zap className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Main Dock */}
            <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
            >
                <div className="flex items-center gap-2 px-4 py-2 bg-[var(--citadel-surface)]/95 backdrop-blur-md border border-[var(--citadel-border)] rounded-2xl shadow-lg">
                    {/* Persona Avatar & Info */}
                    <button
                        onClick={onExpandPanel}
                        className="flex items-center gap-3 px-3 py-1.5 rounded-xl hover:bg-[var(--citadel-elevated)] transition-colors group"
                    >
                        <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all",
                            isThinking
                                ? "bg-[var(--mind-aqua-glow)]/30 animate-pulse"
                                : "bg-[var(--mind-aqua-glow)]/20"
                        )}>
                            {activePersona?.avatar || '🧠'}
                        </div>
                        <div className="text-left">
                            <div className="text-sm font-medium text-[var(--text-primary)]">
                                {activePersona?.name || 'Mind'}
                            </div>
                            <div className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                                <span className={cn(
                                    "w-1.5 h-1.5 rounded-full",
                                    status === 'ready' ? "bg-[var(--truth-green)]" :
                                        status === 'processing' ? "bg-[var(--truth-amber)] animate-pulse" :
                                            "bg-[var(--text-muted)]"
                                )} />
                                {status === 'processing' ? 'Processing...' : `${totalContext} ctx`}
                            </div>
                        </div>
                        <ChevronUp className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
                    </button>

                    {/* Divider */}
                    <div className="w-px h-8 bg-[var(--citadel-border)]" />

                    {/* Quick Actions */}
                    <div className="flex items-center gap-1">
                        {/* Think */}
                        <button
                            onClick={handleQuickThink}
                            disabled={isThinking}
                            className={cn(
                                "p-2.5 rounded-xl transition-all",
                                isThinking
                                    ? "bg-[var(--mind-aqua-glow)]/20 text-[var(--mind-aqua-glow)] animate-pulse"
                                    : "hover:bg-[var(--citadel-elevated)] text-[var(--text-muted)] hover:text-[var(--mind-aqua-glow)]"
                            )}
                            title="Think (analyze context)"
                        >
                            <Sparkles className="w-5 h-5" />
                        </button>

                        {/* Quick Chat Toggle */}
                        <button
                            onClick={() => setQuickChatOpen(!quickChatOpen)}
                            className={cn(
                                "p-2.5 rounded-xl transition-all",
                                quickChatOpen
                                    ? "bg-[var(--citadel-primary)]/20 text-[var(--citadel-primary)]"
                                    : "hover:bg-[var(--citadel-elevated)] text-[var(--text-muted)] hover:text-[var(--citadel-primary)]"
                            )}
                            title="Quick Ask"
                        >
                            <MessageCircle className="w-5 h-5" />
                        </button>

                        {/* Settings / Expand */}
                        <button
                            onClick={onExpandPanel}
                            className="p-2.5 rounded-xl hover:bg-[var(--citadel-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all"
                            title="Open Mind Panel (M)"
                        >
                            <Settings className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Keyboard Hint */}
                <div className="text-center mt-2">
                    <span className="text-[10px] text-[var(--text-muted)]/50 px-2 py-0.5 bg-[var(--citadel-surface)]/50 rounded">
                        Press M to expand
                    </span>
                </div>
            </motion.div>
        </>
    );
}

export default MindDock;
