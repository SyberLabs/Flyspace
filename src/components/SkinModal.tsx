'use client';

// ============================================
// PROJECT OMNI: SKIN MODAL
// LLM-powered aesthetic generator UI
// ============================================

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Palette,
    X,
    Sparkles,
    Monitor,
    BookOpen,
    Cpu,
    Sun,
    Loader2,
    Check,
    RotateCcw
} from 'lucide-react';
import { getSkinService, PRESET_THEMES, SkinTheme } from '@/core/services/skin.service';
import { cn } from '@/lib/utils';

interface SkinModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const PRESET_ICONS: Record<string, React.ReactNode> = {
    command: <Monitor className="w-5 h-5" />,
    journal: <BookOpen className="w-5 h-5" />,
    cybernetic: <Cpu className="w-5 h-5" />,
    minimal: <Sun className="w-5 h-5" />
};

export function SkinModal({ isOpen, onClose }: SkinModalProps) {
    const [prompt, setPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activePreset, setActivePreset] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const skinService = getSkinService();

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim()) return;

        setIsGenerating(true);
        setError(null);
        setSuccess(false);
        setActivePreset(null);

        try {
            const result = await skinService.generateSkin(prompt);

            if (result.success && result.variables) {
                skinService.applyTheme(result.variables);
                setSuccess(true);
                setTimeout(() => setSuccess(false), 2000);
            } else {
                setError(result.error || 'Failed to generate theme');
            }
        } catch (err) {
            setError((err as Error).message);
        } finally {
            setIsGenerating(false);
        }
    }, [prompt, skinService]);

    const handlePresetClick = useCallback((preset: SkinTheme) => {
        skinService.applyTheme(preset.variables);
        setActivePreset(preset.id);
        setError(null);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 1500);
    }, [skinService]);

    const handleReset = useCallback(() => {
        skinService.resetTheme();
        setActivePreset(null);
        setPrompt('');
        setError(null);
    }, [skinService]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleGenerate();
        }
    }, [handleGenerate]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg"
                    >
                        <div className="bg-[var(--citadel-elevated)] border border-[var(--citadel-border)] rounded-2xl shadow-2xl overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--citadel-border)] bg-gradient-to-r from-[var(--citadel-accent)]/10 to-[var(--citadel-primary)]/10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--citadel-accent)] to-[var(--citadel-primary)] flex items-center justify-center">
                                        <Palette className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                            SKIN Generator
                                        </h2>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            Transform your Citadel aesthetic
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={onClose}
                                    className="p-2 rounded-lg hover:bg-[var(--citadel-border)]/50 transition-colors"
                                >
                                    <X className="w-5 h-5 text-[var(--text-muted)]" />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="p-6 space-y-6">
                                {/* Prompt Input */}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-[var(--text-secondary)]">
                                        Describe your aesthetic
                                    </label>
                                    <div className="relative">
                                        <textarea
                                            value={prompt}
                                            onChange={(e) => setPrompt(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            placeholder="e.g., Warm amber tones with wood texture, Renaissance scholar vibes..."
                                            className="w-full h-24 px-4 py-3 bg-[var(--citadel-surface)] border border-[var(--citadel-border)] rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--citadel-primary)] transition-colors"
                                        />
                                        <button
                                            onClick={handleGenerate}
                                            disabled={isGenerating || !prompt.trim()}
                                            className={cn(
                                                "absolute right-3 bottom-3 px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2",
                                                isGenerating || !prompt.trim()
                                                    ? "bg-[var(--citadel-border)] text-[var(--text-muted)] cursor-not-allowed"
                                                    : "bg-gradient-to-r from-[var(--citadel-accent)] to-[var(--citadel-primary)] text-white hover:shadow-lg hover:shadow-[var(--citadel-primary)]/25"
                                            )}
                                        >
                                            {isGenerating ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 animate-spin" />
                                                    Generating...
                                                </>
                                            ) : success ? (
                                                <>
                                                    <Check className="w-4 h-4" />
                                                    Applied!
                                                </>
                                            ) : (
                                                <>
                                                    <Sparkles className="w-4 h-4" />
                                                    Generate
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    {error && (
                                        <p className="text-sm text-[var(--truth-red)]">{error}</p>
                                    )}
                                </div>

                                {/* Preset Themes */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-[var(--text-secondary)]">
                                            Quick Presets
                                        </label>
                                        <button
                                            onClick={handleReset}
                                            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1 transition-colors"
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            Reset to Default
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        {PRESET_THEMES.map((preset) => (
                                            <button
                                                key={preset.id}
                                                onClick={() => handlePresetClick(preset)}
                                                className={cn(
                                                    "flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                                                    activePreset === preset.id
                                                        ? "border-[var(--citadel-primary)] bg-[var(--citadel-primary)]/10"
                                                        : "border-[var(--citadel-border)] hover:border-[var(--citadel-primary)]/50 hover:bg-[var(--citadel-surface)]"
                                                )}
                                            >
                                                <div className={cn(
                                                    "w-10 h-10 rounded-lg flex items-center justify-center",
                                                    activePreset === preset.id
                                                        ? "bg-[var(--citadel-primary)] text-[var(--citadel-void)]"
                                                        : "bg-[var(--citadel-surface)] text-[var(--text-secondary)]"
                                                )}>
                                                    {PRESET_ICONS[preset.id]}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                                                        {preset.name}
                                                    </p>
                                                    <p className="text-xs text-[var(--text-muted)] truncate">
                                                        {preset.description}
                                                    </p>
                                                </div>
                                                {activePreset === preset.id && (
                                                    <Check className="w-4 h-4 text-[var(--citadel-primary)]" />
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Live Preview Hint */}
                                <div className="flex items-center gap-2 px-4 py-3 bg-[var(--citadel-surface)] rounded-lg border border-[var(--citadel-border)]">
                                    <div className="w-2 h-2 rounded-full bg-[var(--truth-green)] animate-pulse" />
                                    <span className="text-xs text-[var(--text-muted)]">
                                        Changes apply in real-time. Look at the UI behind this modal!
                                    </span>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--citadel-border)] bg-[var(--citadel-surface)]/50">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

export default SkinModal;
