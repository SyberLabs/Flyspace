import React from 'react';
import { useMindStore } from '@/core/stores';
import { ContextEntryType } from '@/core/schemas/mind.schema';
import { Brain, Eye, Target, TrendingUp, X } from 'lucide-react';

interface ContextCaptureModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedText: string;
}

export function ContextCaptureModal({ isOpen, onClose, selectedText }: ContextCaptureModalProps) {
    const pushContext = useMindStore(state => state.pushContext);
    const activePersona = useMindStore(state => state.getActivePersona());

    if (!isOpen) return null;

    const handleSave = (type: ContextEntryType, poolId: string) => {
        pushContext(poolId, {
            type,
            content: selectedText,
            importance: 1.0,
            metadata: {
                source: activePersona?.name || 'User Selection',
                savedAt: Date.now(),
                isManualCapture: true
            }
        });
        onClose();
    };

    const choices: { type: ContextEntryType; pool: string; label: string; hint: string; Icon: typeof Eye }[] = [
        { type: 'observation', pool: 'observations', label: 'Observation', hint: 'Current reality', Icon: Eye },
        { type: 'directive', pool: 'directives', label: 'Directive', hint: 'Action item', Icon: Target },
        { type: 'prediction', pool: 'predictions', label: 'Prediction', hint: 'Future outcome', Icon: TrendingUp },
        { type: 'memory', pool: 'memory', label: 'Memory', hint: 'Long-term fact', Icon: Brain }
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[rgba(5,6,10,0.72)]" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="capture-title"
                className="bg-[var(--sy-surface)] border border-[var(--sy-line)] rounded-lg w-full max-w-[520px] shadow-[var(--sy-shadow-overlay)] flex flex-col animate-fade-in"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center gap-4 pl-6 pr-3 py-3 border-b border-[var(--sy-line)]">
                    <div>
                        <p className="sy-label">Highlight</p>
                        <h3 id="capture-title" className="text-lg leading-7 font-semibold text-[var(--sy-text)]">Capture context</h3>
                    </div>
                    <button type="button" onClick={onClose} className="sy-icon-btn" aria-label="Close">
                        <X />
                    </button>
                </div>

                <blockquote className="mx-6 mt-6 pl-4 border-l-2 border-[var(--sy-line-strong)] max-h-[200px] overflow-y-auto text-base text-[var(--sy-text-2)]">
                    {selectedText}
                </blockquote>

                <p className="mx-6 mt-6 text-sm font-medium text-[var(--sy-text)]">Save it as</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-6 pt-2">
                    {choices.map(({ type, pool, label, hint, Icon }) => (
                        <button
                            key={type}
                            type="button"
                            className="flex items-center gap-3 min-h-11 px-4 py-3 border border-[var(--sy-line-strong)] rounded-lg text-left hover:bg-[var(--sy-surface-2)] transition-colors"
                            onClick={() => handleSave(type, pool)}
                        >
                            <Icon className="w-5 h-5 flex-none text-[var(--sy-text-2)]" strokeWidth={1.5} aria-hidden="true" />
                            <span className="flex flex-col">
                                <span className="text-sm font-medium text-[var(--sy-text)]">{label}</span>
                                <span className="text-xs text-[var(--sy-text-3)]">{hint}</span>
                            </span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
