'use client';

// ============================================
// PROJECT OMNI: BLOCK ERROR BOUNDARY (apex A5)
// Failure isolation: one crashing block view must never take down the
// canvas. The boundary wraps each block's inner view (inside BlockCard),
// so the card chrome — drag, delete, wires — stays functional and the
// user can retry or remove the crashed block.
// ============================================

import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { debug } from '@/core/debug';

interface BlockErrorBoundaryProps {
    /** Display name of the block, for the fallback message */
    blockName: string;
    children: ReactNode;
}

interface BlockErrorBoundaryState {
    error: Error | null;
}

export class BlockErrorBoundary extends Component<BlockErrorBoundaryProps, BlockErrorBoundaryState> {
    state: BlockErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): BlockErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        debug(`[BlockErrorBoundary] "${this.props.blockName}" crashed:`, error, info.componentStack);
    }

    private handleRetry = () => {
        this.setState({ error: null });
    };

    render() {
        if (this.state.error) {
            return (
                <div
                    data-testid="block-crash-fallback"
                    className="flex flex-col items-center justify-center gap-2 h-full min-h-[120px] p-4 text-center"
                >
                    <AlertTriangle className="w-6 h-6 text-[var(--truth-red)]" />
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                        {this.props.blockName} crashed
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] max-w-[220px] break-words">
                        The rest of the canvas is unaffected.
                        {this.state.error.message ? ` (${this.state.error.message.slice(0, 120)})` : ''}
                    </p>
                    <button
                        onClick={this.handleRetry}
                        className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-[var(--citadel-border)] text-[var(--text-secondary)] hover:border-[var(--citadel-primary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <RotateCcw className="w-3 h-3" />
                        Retry
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
