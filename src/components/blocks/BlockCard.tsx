'use client';

// ============================================
// PROJECT OMNI: GENERIC BLOCK CARD WRAPPER
// ============================================

import { ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import {
    X,
    GripVertical,
    Pin,
    PinOff,
    Brain
} from 'lucide-react';
import { BlockInstance, ConnectionStatus } from '@/core/schemas/block.schema';
import { useMindStore, useUIStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { WireHandle } from '@/canvas/WireHandle';
import { BlockErrorBoundary } from './BlockErrorBoundary';
import { getInputPorts, getOutputPorts } from '@/core/services/port.service';
import { cn } from '@/lib/utils';
import { BlockGlyph } from '@/components/blockIcons';

import { type DraggableAttributes, type DraggableSyntheticListeners } from '@dnd-kit/core';

/**
 * dnd-kit's drag wiring, applied to the grip only. Spreading `attributes` on
 * the whole card made the card a role="button" that swallowed the names of
 * the controls inside it (FINDINGS.md).
 */
export interface BlockDragHandle {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
    setActivatorNodeRef: (element: HTMLElement | null) => void;
}

interface BlockCardProps {
    block: BlockInstance;
    children: ReactNode;
    onClose?: () => void;
    isDragging?: boolean;
    dragHandle?: BlockDragHandle;
}

export function BlockCard({
    block,
    children,
    onClose,
    isDragging = false,
    dragHandle
}: BlockCardProps) {
    const [isHovered, setIsHovered] = useState(false);

    const statusColor = getStatusColor(block.status);

    // Get ports for this block
    const inputPorts = getInputPorts(block.schema);
    const outputPorts = getOutputPorts(block.schema);

    // Focus (pin) state
    const isPinned = useMindStore(state => state.isPinned(block.instance_id));
    // Lit while a provenance chip for this block is hovered (see PersonaBlock).
    const isCited = useUIStore(state => state.highlightedBlockIds.includes(block.instance_id));
    const pinBlock = useMindStore(state => state.pinBlock);
    const unpinBlock = useMindStore(state => state.unpinBlock);

    // Check if this block is wired to any persona
    // Check if this block is wired to any persona (Subscribe to wire store changes)
    const wires = useWireStore(state => state.wires);
    const wiresFromBlock = wires.filter(w => w.sourceBlockId === block.instance_id);
    const wiresToBlock = wires.filter(w => w.targetBlockId === block.instance_id);
    const hasOutgoingWires = wiresFromBlock.length > 0;
    const hasIncomingWires = wiresToBlock.length > 0;
    const isWired = hasOutgoingWires || hasIncomingWires;

    const handleTogglePin = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isPinned) {
            unpinBlock(block.instance_id);
        } else {
            const success = pinBlock(block.instance_id, block.schema.block_id, block.data);
            if (!success) {
                console.warn('Max 5 focused blocks reached');
            }
        }
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{
                opacity: 1,
                scale: isDragging ? 1.02 : 1,
                boxShadow: isDragging
                    ? '0 20px 40px rgba(0, 0, 0, 0.4), 0 0 40px rgba(99, 102, 241, 0.2)'
                    : isCited
                        ? '0 0 0 1px rgba(34, 211, 238, 0.35), 0 0 28px rgba(34, 211, 238, 0.25)'
                        : undefined
            }}
            exit={{ opacity: 0, scale: 0.95 }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            data-cited={isCited ? 'true' : 'false'}
            className={cn(
                "block-card flex flex-col group",
                isDragging && "ring-2 ring-[var(--citadel-primary)]",
                isPinned && "ring-1 ring-[var(--mind-aqua-surface)] shadow-[0_0_12px_rgba(99,255,230,0.15)]",
                !isPinned && isWired && "ring-1 ring-[var(--truth-amber)]/20",
                isCited && "ring-2 ring-[var(--citadel-secondary)]"
            )}
            style={{
                width: block.dimensions.width,
                height: block.dimensions.height
            }}
        >
            {/* Ultra-compact Header */}
            <div className="block-header py-1 px-1.5">
                <div className="flex items-center gap-1 min-w-0">
                    {/* Drag Handle */}
                    <button
                        type="button"
                        ref={dragHandle?.setActivatorNodeRef}
                        {...dragHandle?.attributes}
                        {...dragHandle?.listeners}
                        aria-label={`Move ${block.schema.display_name}`}
                        title="Drag to move"
                        className="cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors flex-shrink-0"
                    >
                        <GripVertical className="w-3 h-3" aria-hidden="true" />
                    </button>

                    {/* Status Dot + Icon */}
                    <div className="relative flex-shrink-0">
                        <div
                            className="w-5 h-5 rounded flex items-center justify-center bg-[var(--citadel-surface)]/50"
                            style={{ color: statusColor }}
                        >
                            <BlockGlyph name={block.schema.icon} className="w-3 h-3" />
                        </div>
                        {/* Connection indicators as tiny dots */}
                        {hasIncomingWires && (
                            <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--truth-green)]" />
                        )}
                        {hasOutgoingWires && (
                            <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[var(--truth-amber)]" />
                        )}
                    </div>

                    {/* Title - truncated */}
                    <span className="text-xs font-medium text-[var(--text-secondary)] truncate flex-1">
                        {block.schema.display_name}
                    </span>

                    {/* Pinned indicator - compact */}
                    {isPinned && (
                        <span className="text-xs text-[var(--mind-aqua-surface)] flex-shrink-0">📍</span>
                    )}
                </div>

                {/* Controls - visible on hover */}
                <div className={cn(
                    "flex items-center gap-0.5 transition-opacity duration-200 flex-shrink-0",
                    isHovered ? "opacity-100" : "opacity-0"
                )}>
                    {/* Pin/Unpin Button */}
                    <button
                        onClick={handleTogglePin}
                        className={cn(
                            "btn-ghost p-0.5 rounded",
                            isPinned
                                ? "text-[var(--mind-aqua-surface)] hover:bg-[var(--mind-aqua-surface)]/10"
                                : "hover:text-[var(--mind-aqua-surface)]"
                        )}
                        title={isPinned ? 'Unpin' : 'Pin'}
                    >
                        {isPinned ? (
                            <PinOff className="w-3 h-3" />
                        ) : (
                            <Pin className="w-3 h-3" />
                        )}
                    </button>
                    {/* Save to Memory Button */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            useMindStore.getState().saveToMemory(block.instance_id, block.schema.block_id, block.data);
                        }}
                        className="btn-ghost p-0.5 rounded hover:text-[var(--truth-amber)]"
                        title="Save"
                    >
                        <Brain className="w-3 h-3" />
                    </button>
                    <button
                        onClick={onClose}
                        className="btn-ghost p-0.5 rounded hover:bg-red-500/10 hover:text-red-400"
                        title="Close"
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>

            {/* Content — isolated: a crashing view can't take down the canvas,
                and the card chrome (drag/delete/wires) stays functional. */}
            <div className="block-content flex-1 overflow-hidden p-0">
                <BlockErrorBoundary blockName={block.schema.display_name}>
                    {children}
                </BlockErrorBoundary>
            </div>

            {/* Unified Port Handles (with type indicators and drag functionality) */}
            <WireHandle
                blockId={block.instance_id}
                side="left"
                ports={inputPorts}
                connectionCount={wiresToBlock.length}
            />
            <WireHandle
                blockId={block.instance_id}
                side="right"
                ports={outputPorts}
                connectionCount={wiresFromBlock.length}
            />
        </motion.div>
    );
}

function getStatusColor(status: ConnectionStatus): string {
    switch (status) {
        case 'connected': return 'var(--truth-green)';
        case 'connecting': return 'var(--truth-amber)';
        case 'error': return 'var(--truth-red)';
        case 'paused': return 'var(--citadel-secondary)';
        default: return 'var(--text-muted)';
    }
}
