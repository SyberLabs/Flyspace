'use client';

// ============================================
// PROJECT OMNI: THINK RESULT MODAL
// Glassmorphic popup for Mind's Think output
// ============================================

import { useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useBlockStore } from '@/core/stores';
import { cn } from '@/lib/utils';
import './ThinkResultModal.css';

interface ThinkResultModalProps {
    isOpen: boolean;
    onClose: () => void;
    response: string;
    personaName?: string;
}

export function ThinkResultModal({
    isOpen,
    onClose,
    response,
    personaName = 'The Mind'
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
            data_type: 'text' as const,
            semantic_tags: ['insight', 'mind', 'analysis'],
            icon: 'text',
            refresh_rate: 'never', // Static content
            wiring_logic: 'bidirectional' // Can connect in both directions
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
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="think-modal-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="think-modal-header">
                            <div className="think-modal-title">
                                <div>
                                    <p className="sy-label">Answer</p>
                                    <h2 id="think-modal-title">{personaName}&apos;s response</h2>
                                </div>
                            </div>
                            <button type="button" className="sy-icon-btn" onClick={onClose} aria-label="Close response">
                                <X />
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
                                type="button"
                                className="btn btn-secondary"
                                onClick={handleCopy}
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-4 h-4" />
                                        Copied
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-4 h-4" />
                                        Copy
                                    </>
                                )}
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleCrystallize}
                            >
                                Keep as a block
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

export default ThinkResultModal;
