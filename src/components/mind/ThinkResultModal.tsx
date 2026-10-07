'use client';

// ============================================
// PROJECT OMNI: THINK RESULT MODAL
// Glassmorphic popup for Mind's Think output
// ============================================

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Sparkles, Check } from 'lucide-react';
import { useState } from 'react';
import { useBlockStore } from '@/core/stores';
import { cn } from '@/lib/utils';
import './ThinkResultModal.css';

interface ThinkResultModalProps {
    isOpen: boolean;
    onClose: () => void;
    response: string;
    personaName?: string;
    personaEmoji?: string;
}

export function ThinkResultModal({
    isOpen,
    onClose,
    response,
    personaName = 'The Mind',
    personaEmoji = '🧠'
}: ThinkResultModalProps) {
    const [copied, setCopied] = useState(false);
    const addBlock = useBlockStore(state => state.addBlock);

    // ESC to close
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (isOpen) {
            window.addEventListener('keydown', handleEsc);
            return () => window.removeEventListener('keydown', handleEsc);
        }
    }, [isOpen, onClose]);

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(response);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [response]);

    const handleCrystallize = useCallback(() => {
        // Create a Text Block with the response content
        const textBlockSchema = {
            block_id: 'text_note',
            display_name: `${personaName}'s Insight`,
            category: 'workspace' as const,
            semantic_tags: ['insight', 'mind', 'analysis'],
            icon: 'text',
        };

        // Add block at a reasonable position
        const blockId = addBlock(textBlockSchema, { x: 100, y: 100 });

        // Update the block's data with the response
        useBlockStore.getState().updateData(blockId, {
            content: response,
            format: 'markdown',
            createdAt: Date.now(),
            source: personaName
        });

        onClose();
    }, [response, personaName, addBlock, onClose]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="think-modal-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className="think-modal"
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Glassmorphism highlight */}
                        <div className="think-modal-highlight" />

                        {/* Header */}
                        <div className="think-modal-header">
                            <div className="think-modal-title">
                                <span className="think-modal-emoji">{personaEmoji}</span>
                                <div>
                                    <h2>{personaName}&apos;s Response</h2>
                                    <span className="think-modal-subtitle">Mind Analysis Complete</span>
                                </div>
                            </div>
                            <button className="think-modal-close" onClick={onClose}>
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="think-modal-content">
                            <div className="think-modal-response">
                                {response.split('\n').map((line, i) => (
                                    <p key={i} className={cn(
                                        line.startsWith('**') && 'font-semibold',
                                        line.startsWith('- ') && 'ml-4',
                                        line.startsWith('* ') && 'ml-4',
                                        !line.trim() && 'h-4'
                                    )}>
                                        {line || '\u00A0'}
                                    </p>
                                ))}
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="think-modal-footer">
                            <button
                                className="think-modal-btn think-modal-btn-secondary"
                                onClick={handleCopy}
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-4 h-4" />
                                        Copied!
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        Copy
                                    </>
                                )}
                            </button>
                            <button
                                className="think-modal-btn think-modal-btn-primary"
                                onClick={handleCrystallize}
                            >
                                <Sparkles className="w-4 h-4" />
                                Crystallize to Block
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default ThinkResultModal;
