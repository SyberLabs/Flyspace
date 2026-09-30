import React from 'react';
import { useMindStore } from '@/core/stores';
import { ContextEntryType } from '@/core/schemas/mind.schema';

interface ContextCaptureModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedText: string;
}

export function ContextCaptureModal({ isOpen, onClose, selectedText }: ContextCaptureModalProps) {
    const addToPool = useMindStore(state => state.addToPool);

    if (!isOpen) return null;

    const handleSave = (type: ContextEntryType, poolId: string) => {
        addToPool(poolId, {
            type,
            content: selectedText,
            importance: 1.0,
            metadata: {
                source: 'User Selection',
                savedAt: Date.now(),
                isManualCapture: true
            }
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="bg-[#0a0a0a] border border-[var(--cyan-glow)]/30 rounded-lg p-6 w-[500px] max-w-[90vw] shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col gap-4 animate-in fade-in zoom-in duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center border-b border-white/10 pb-3">
                    <h3 className="text-lg font-medium text-[var(--cyan-glow)] flex items-center gap-2">
                        <span>🖊️</span> Capture Context
                    </h3>
                    <button onClick={onClose} className="text-white/50 hover:text-white transition-colors">✕</button>
                </div>

                <div className="bg-black/40 rounded p-3 border border-white/5 max-h-[200px] overflow-y-auto text-sm text-gray-300 font-mono italic">
                    &quot;{selectedText}&quot;
                </div>

                <div className="grid grid-cols-2 gap-3 mt-2">
                    <button
                        className="flex items-center justify-center gap-2 p-3 bg-[var(--cyan-glow)]/10 hover:bg-[var(--cyan-glow)]/20 border border-[var(--cyan-glow)]/30 rounded transition-all group"
                        onClick={() => handleSave('observation', 'observations')}
                    >
                        <span>👁️</span>
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-[var(--cyan-glow)]">Observation</span>
                            <span className="text-xs text-white/50">Current reality</span>
                        </div>
                    </button>

                    <button
                        className="flex items-center justify-center gap-2 p-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-all"
                        onClick={() => handleSave('directive', 'directives')}
                    >
                        <span>🎯</span>
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-emerald-400">Directive</span>
                            <span className="text-xs text-white/50">Action item</span>
                        </div>
                    </button>

                    <button
                        className="flex items-center justify-center gap-2 p-3 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded transition-all"
                        onClick={() => handleSave('prediction', 'predictions')}
                    >
                        <span>🔮</span>
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-purple-400">Prediction</span>
                            <span className="text-xs text-white/50">Future outcome</span>
                        </div>
                    </button>

                    <button
                        className="flex items-center justify-center gap-2 p-3 bg-[var(--truth-amber)]/10 hover:bg-[var(--truth-amber)]/20 border border-[var(--truth-amber)]/30 rounded transition-all"
                        onClick={() => handleSave('memory', 'memory')}
                    >
                        <span>🧠</span>
                        <div className="flex flex-col items-start">
                            <span className="text-sm font-medium text-[var(--truth-amber)]">Memory</span>
                            <span className="text-xs text-white/50">Long-term fact</span>
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
