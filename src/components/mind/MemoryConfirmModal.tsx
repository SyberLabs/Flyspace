'use client';

// ============================================
// PROJECT OMNI: MEMORY CONFIRMATION MODAL
// Confirm before saving AI-suggested memories
// ============================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, X, Check, Edit3, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MemoryConfirmModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (content: string) => void;
    suggestion: string;
    source?: string;
}

export function MemoryConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    suggestion,
    source
}: MemoryConfirmModalProps) {
    const [editedContent, setEditedContent] = useState(suggestion);
    const [isEditing, setIsEditing] = useState(false);

    // Reset state when modal opens with new suggestion
    const handleOpen = () => {
        setEditedContent(suggestion);
        setIsEditing(false);
    };

    const handleConfirm = () => {
        onConfirm(editedContent);
        onClose();
    };

    const handleDiscard = () => {
        onClose();
    };

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
                        onAnimationComplete={handleOpen}
                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
                    >
                        <div className="bg-[var(--citadel-elevated)] border border-[var(--citadel-border)] rounded-2xl shadow-2xl overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--citadel-border)] bg-gradient-to-r from-[var(--truth-amber)]/10 to-[var(--mind-aqua-surface)]/10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--truth-amber)] to-[var(--mind-aqua-surface)] flex items-center justify-center">
                                        <Brain className="w-5 h-5 text-white" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                            Save to Memory?
                                        </h2>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {source ? `Suggested by ${source}` : 'AI-generated insight'}
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
                            <div className="p-5 space-y-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-[var(--text-secondary)]">
                                            Memory Content
                                        </label>
                                        <button
                                            onClick={() => setIsEditing(!isEditing)}
                                            className={cn(
                                                "text-xs flex items-center gap-1 transition-colors",
                                                isEditing
                                                    ? "text-[var(--citadel-primary)]"
                                                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                            )}
                                        >
                                            <Edit3 className="w-3 h-3" />
                                            {isEditing ? 'Editing' : 'Edit'}
                                        </button>
                                    </div>

                                    {isEditing ? (
                                        <textarea
                                            value={editedContent}
                                            onChange={(e) => setEditedContent(e.target.value)}
                                            className="w-full h-32 px-4 py-3 bg-[var(--citadel-surface)] border border-[var(--citadel-primary)]/50 rounded-xl text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-none focus:outline-none focus:border-[var(--citadel-primary)] transition-colors text-sm"
                                            autoFocus
                                        />
                                    ) : (
                                        <div className="px-4 py-3 bg-[var(--citadel-surface)] border border-[var(--citadel-border)] rounded-xl">
                                            <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
                                                {editedContent}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                {/* Info hint */}
                                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--truth-amber)]/10 rounded-lg border border-[var(--truth-amber)]/20">
                                    <Brain className="w-4 h-4 text-[var(--truth-amber)]" />
                                    <span className="text-xs text-[var(--text-muted)]">
                                        Saved memories persist across sessions and inform future analyses.
                                    </span>
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--citadel-border)] bg-[var(--citadel-surface)]/50">
                                <button
                                    onClick={handleDiscard}
                                    className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--truth-red)] flex items-center gap-2 transition-colors"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Discard
                                </button>
                                <button
                                    onClick={handleConfirm}
                                    disabled={!editedContent.trim()}
                                    className={cn(
                                        "px-5 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2",
                                        editedContent.trim()
                                            ? "bg-gradient-to-r from-[var(--truth-amber)] to-[var(--mind-aqua-surface)] text-white hover:shadow-lg"
                                            : "bg-[var(--citadel-border)] text-[var(--text-muted)] cursor-not-allowed"
                                    )}
                                >
                                    <Check className="w-4 h-4" />
                                    Save Memory
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
