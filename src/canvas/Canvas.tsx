'use client';

// ============================================
// PROJECT OMNI: DRAG-AND-DROP CANVAS
// ============================================

import { createElement, useCallback, useState, useEffect, useMemo } from 'react';
import {
    DndContext,
    DragEndEvent,
    DragStartEvent,
    DragMoveEvent,
    useDraggable,
    PointerSensor,
    useSensor,
    useSensors
} from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { useBlockStore, useSettingsStore, useUIStore } from '@/core/stores';
import { BlockCard } from '@/components/blocks/BlockCard';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { WireRenderer } from './WireRenderer';
import { snapToGrid, cn } from '@/lib/utils';
import { getBlockView } from '@/core/registry/ViewRegistry';
import { useClientMounted } from '@/core/hooks';
import { Atmosphere } from '@/components/brand/Atmosphere';
import { Sigil } from '@/components/brand/Sigil';
import { spatialSession } from '@/core/interaction/session';
import { point } from '@/core/interaction/coordinates';

interface CanvasProps {
    hideEmptyState?: boolean;
    /** Opens the Shell Store. The empty canvas leads with it. */
    onBrowseShells?: () => void;
    shellId?: string; // Optional shell ID for filtering blocks
}

export function Canvas({ hideEmptyState = false, shellId, onBrowseShells }: CanvasProps) {
    const {
        blocks,
        addBlock,
        removeBlock,
        activeShellId,
        setActiveShell
    } = useBlockStore();
    const { gridSnapping, gridSize } = useSettingsStore();
    const { draggingBlockId, setDraggingBlock, setSelectedBlock, selectedBlockId } = useUIStore();
    const [activeDragId, setActiveDragId] = useState<string | null>(null);
    const [dragDelta, setDragDelta] = useState<{ x: number; y: number } | null>(null);

    const hasMounted = useClientMounted();

    // Use shellId prop or fallback to active shell
    const currentShell = shellId || activeShellId;

    // Filter blocks by shell (only after mount to avoid hydration mismatch).
    // Wires are rendered by WireRenderer straight from the wire store.
    const shellBlocks = useMemo(
        () => hasMounted ? blocks.filter(b => b.shellId === currentShell) : [],
        [hasMounted, blocks, currentShell]
    );

    // Set active shell when shellId prop changes
    useEffect(() => {
        if (shellId && shellId !== activeShellId) {
            setActiveShell(shellId);
        }
    }, [shellId, activeShellId, setActiveShell]);

    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8
            }
        })
    );

    // Sidebar drop. Native HTML5 DnD (the sidebar sets dataTransfer), handled
    // here rather than by CitadelApp querySelecting this element.
    const [isSidebarOver, setIsSidebarOver] = useState(false);

    const handleSidebarDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setIsSidebarOver(true);
    };

    const handleSidebarDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsSidebarOver(false);
    };

    const handleSidebarDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsSidebarOver(false);
        const blockId = e.dataTransfer.getData('text/plain');
        const schema = blockId ? blockRegistry.get(blockId) : undefined;
        if (schema) {
            const rect = e.currentTarget.getBoundingClientRect();
            addBlock(schema, {
                x: Math.max(0, e.clientX - rect.left - 160),
                y: Math.max(0, e.clientY - rect.top - 20)
            }, currentShell);
        }
        setDraggingBlock(null);
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveDragId(event.active.id as string);
        setDragDelta({ x: 0, y: 0 });
    };

    const handleDragMove = (event: DragMoveEvent) => {
        if (event.delta) {
            setDragDelta({ x: event.delta.x, y: event.delta.y });
        }
    };

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        setActiveDragId(null);
        setDragDelta(null);
        const { active, delta } = event;

        if (!delta) return;

        const blockId = active.id as string;
        const block = shellBlocks.find(b => b.instance_id === blockId);

        if (block) {
            let newX = block.position.x + delta.x;
            let newY = block.position.y + delta.y;

            if (gridSnapping) {
                newX = snapToGrid(newX, gridSize);
                newY = snapToGrid(newY, gridSize);
            }

            // Ensure blocks stay within bounds
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);

            spatialSession.pointerMove(blockId, { x: newX, y: newY });
        }
    }, [shellBlocks, gridSnapping, gridSize]);

    return (
        <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
        >
            <div
                className={cn(
                    "canvas-workspace relative",
                    isSidebarOver && draggingBlockId && "ring-2 ring-inset ring-[var(--citadel-primary)]/30"
                )}
                onDragOver={handleSidebarDragOver}
                onDragLeave={handleSidebarDragLeave}
                onDrop={handleSidebarDrop}
                onPointerDown={event => {
                    const target = event.target as HTMLElement;
                    if (target.closest('.block-card')) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    spatialSession.select([]);
                    spatialSession.notePoint(
                        point('canvas', event.clientX - rect.left, event.clientY - rect.top),
                        Date.now(),
                        'pointer'
                    );
                }}
            >
                {/* Grid overlay */}
                <div className="canvas-grid" />

                {/* Blocks - filtered by shell */}
                {shellBlocks.map(block => (
                    <DraggableBlock
                        key={block.instance_id}
                        id={block.instance_id}
                        isDragging={activeDragId === block.instance_id}
                        isSelected={selectedBlockId === block.instance_id}
                        onSelect={() => {
                            setSelectedBlock(block.instance_id);
                            spatialSession.select([block.instance_id]);
                            spatialSession.notePoint(
                                point('canvas', block.position.x + 8, block.position.y + 8),
                                Date.now(),
                                'pointer'
                            );
                        }}
                        onClose={() => removeBlock(block.instance_id)}
                    />
                ))}

                {/* Wire connections layer - filtered by shell */}
                <WireRenderer
                    activeDragId={activeDragId}
                    dragDelta={dragDelta}
                    shellId={currentShell}
                />

                {/* Drop indicator when dragging from Armory */}
                {draggingBlockId && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                        <div className="text-[var(--text-muted)] text-sm bg-[var(--citadel-surface)]/80 px-4 py-2 rounded-lg backdrop-blur-sm">
                            Drop to add block
                        </div>
                    </motion.div>
                )}

                {/* Empty state - shell-aware */}
                {shellBlocks.length === 0 && !draggingBlockId && !hideEmptyState && (
                    <>
                        {/* Ambient plate: empty state only, never under blocks */}
                        {hasMounted && <Atmosphere />}
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="empty-state text-center pointer-events-auto max-w-md px-6">
                                <div className="plate-frame mb-6" aria-hidden="true">
                                    <Sigil size={64} />
                                </div>
                                <div className="empty-state-title mb-3">
                                    Start with an environment
                                </div>
                                <p className="text-[var(--text-secondary)] text-base leading-relaxed mb-7">
                                    A shell arrives pre-wired — live data blocks already connected to
                                    personas, so you can ask a question immediately.
                                </p>
                                {onBrowseShells && (
                                    <button
                                        onClick={onBrowseShells}
                                        className="btn btn-primary"
                                    >
                                        Browse shells
                                    </button>
                                )}
                                <p className="text-[var(--text-muted)] text-xs mt-6">
                                    Or drag a block from the sidebar, hold Talk or Space, or press{' '}
                                    <kbd className="px-2 py-0.5 border border-[var(--citadel-border)] rounded-full text-xs font-mono text-[var(--text-secondary)]">
                                        &#8984;K
                                    </kbd>{' '}
                                    for the command palette
                                </p>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </DndContext>
    );
}

// ============================================
// DRAGGABLE BLOCK COMPONENT
// ============================================

interface DraggableBlockProps {
    id: string;
    isDragging: boolean;
    isSelected: boolean;
    onSelect: () => void;
    onClose: () => void;
}

function DraggableBlock({ id, isDragging, isSelected, onSelect, onClose }: DraggableBlockProps) {
    const { blocks, updateDimensions, updatePosition } = useBlockStore();
    const block = blocks.find(b => b.instance_id === id);
    const [isResizing, setIsResizing] = useState(false);
    const [resizeStart, setResizeStart] = useState<{
        x: number; y:
        number;
        width: number; height: number;
        posX: number; posY: number;
        handle: string
    } | null>(null);

    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id,
        disabled: isResizing // Disable drag while resizing
    });

    // Handle resize start
    const handleResizeStart = useCallback((e: React.MouseEvent, handle: string) => {
        e.stopPropagation();
        e.preventDefault();
        if (!block) return;

        setIsResizing(true);
        setResizeStart({
            x: e.clientX,
            y: e.clientY,
            width: block.dimensions.width,
            height: block.dimensions.height,
            posX: block.position.x,
            posY: block.position.y,
            handle
        });
    }, [block]);

    // Handle resize move and end
    useEffect(() => {
        if (!isResizing || !resizeStart || !block) return;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - resizeStart.x;
            const deltaY = e.clientY - resizeStart.y;

            let newWidth = resizeStart.width;
            let newHeight = resizeStart.height;
            let newX = resizeStart.posX;
            let newY = resizeStart.posY;

            // Apply resize based on handle position
            // East (right) edge - increase width
            if (resizeStart.handle.includes('e')) {
                newWidth = Math.max(200, resizeStart.width + deltaX);
            }
            // West (left) edge - increase width AND move left
            if (resizeStart.handle.includes('w')) {
                const proposedWidth = resizeStart.width - deltaX;
                if (proposedWidth >= 200) {
                    newWidth = proposedWidth;
                    newX = resizeStart.posX + deltaX;
                }
            }
            // South (bottom) edge - increase height
            if (resizeStart.handle.includes('s')) {
                newHeight = Math.max(150, resizeStart.height + deltaY);
            }
            // North (top) edge - increase height AND move up
            if (resizeStart.handle.includes('n')) {
                const proposedHeight = resizeStart.height - deltaY;
                if (proposedHeight >= 150) {
                    newHeight = proposedHeight;
                    newY = resizeStart.posY + deltaY;
                }
            }

            // Update dimensions
            updateDimensions(id, { width: newWidth, height: newHeight });

            // Update position if needed (for left/top edge drags)
            if (resizeStart.handle.includes('w') || resizeStart.handle.includes('n')) {
                updatePosition(id, { x: newX, y: newY });
            }
        };

        const handleMouseUp = () => {
            if (resizeStart && (resizeStart.handle.includes('w') || resizeStart.handle.includes('n'))) {
                const current = useBlockStore.getState().getBlock(id);
                if (current) {
                    updatePosition(id, { x: resizeStart.posX, y: resizeStart.posY });
                    spatialSession.pointerMove(id, { x: current.position.x, y: current.position.y });
                }
            }
            setIsResizing(false);
            setResizeStart(null);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, resizeStart, block, id, updateDimensions, updatePosition]);

    if (!block) return null;

    const style = {
        position: 'absolute' as const,
        left: block.position.x,
        top: block.position.y,
        transform: transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        zIndex: isDragging ? 100 : isSelected ? 50 : 1
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            onClick={onSelect}
            {...attributes}
            className={cn(
                "group relative",
                isSelected && "ring-2 ring-[var(--citadel-primary)]",
                isResizing && "ring-2 ring-[var(--mind-aqua-surface)]"
            )}
        >
            <BlockCard
                block={block}
                isDragging={isDragging}
                onClose={onClose}
                dragListeners={listeners}
            >
                <BlockContent block={block} />
            </BlockCard>

            {/* Resize handles - right, bottom, and SE corner only for intuitive feel */}
            {(isSelected || isResizing) && (
                <>
                    {/* Bottom edge handle */}
                    <div
                        className="absolute bottom-0 left-4 right-4 h-2 cursor-s-resize hover:bg-[var(--citadel-primary)]/50 transition-colors"
                        onMouseDown={(e) => handleResizeStart(e, 's')}
                    />
                    {/* Right edge handle */}
                    <div
                        className="absolute right-0 top-4 bottom-4 w-2 cursor-e-resize hover:bg-[var(--citadel-primary)]/50 transition-colors"
                        onMouseDown={(e) => handleResizeStart(e, 'e')}
                    />

                    {/* SE corner handle - most intuitive */}
                    <div
                        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize bg-[var(--citadel-primary)]/40 hover:bg-[var(--citadel-primary)] rounded-tl-sm transition-colors"
                        onMouseDown={(e) => handleResizeStart(e, 'se')}
                    >
                        {/* Resize grip visual */}
                        <svg className="w-full h-full p-0.5" viewBox="0 0 10 10" fill="currentColor" opacity="0.7">
                            <circle cx="7" cy="7" r="1.2" />
                            <circle cx="4" cy="7" r="1.2" />
                            <circle cx="7" cy="4" r="1.2" />
                        </svg>
                    </div>
                </>
            )}
        </div>
    );
}

// ============================================
// BLOCK CONTENT RENDERER
// ============================================

interface BlockContentProps {
    block: ReturnType<typeof useBlockStore.getState>['blocks'][0];
}

function BlockContent({ block }: BlockContentProps) {
    // Look up a registered view. createElement (not <View />) so the compiler
    // does not treat a map lookup as "creating a component during render".
    const View = getBlockView(block.schema.block_id);
    if (View) {
        return createElement(View, { instanceId: block.instance_id });
    }

    return (
        <div className="p-4 text-center text-[var(--text-muted)]">
            <p>Block type: {block.schema.display_name}</p>
            <p className="text-xs mt-1">Coming in future phase</p>
        </div>
    );
}

export default Canvas;
