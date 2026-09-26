'use client';

// ============================================
// PROJECT OMNI: WIRE HANDLE
// Unified draggable port with type indicators
// ============================================

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plug } from 'lucide-react';
import { wireService } from '@/core/services/wire.service';
import { PortSchema, PortDataType } from '@/core/schemas/block.schema';
import { cn } from '@/lib/utils';

interface WireHandleProps {
    blockId: string;
    side: 'left' | 'right';
    ports?: PortSchema[]; // Port schemas for this side
    connectionCount?: number; // Number of active wires
}

interface DragState {
    isDragging: boolean;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
}

/**
 * Get visual configuration for a port type
 */
function getPortTypeConfig(type: PortDataType): {
    color: string;
    icon: string;
    label: string;
} {
    switch (type) {
        case 'json':
            return { color: '#3B82F6', icon: '🔷', label: 'JSON' };
        case 'text':
            return { color: '#10B981', icon: '📝', label: 'Text' };
        case 'media':
            return { color: '#8B5CF6', icon: '🎨', label: 'Media' };
        case 'any':
            return { color: '#6B7280', icon: '🔌', label: 'Any' };
        default:
            return { color: '#6B7280', icon: '❓', label: 'Unknown' };
    }
}

/**
 * Wire handle component - unified port with type indicators and drag functionality
 */
export function WireHandle({ blockId, side, ports = [], connectionCount = 0 }: WireHandleProps) {
    const [dragState, setDragState] = useState<DragState | null>(null);
    const [isHovering, setIsHovering] = useState(false);
    const handleRef = useRef<HTMLDivElement>(null);

    // Get primary port for this side (first port, or fallback to generic)
    const primaryPort = ports[0];
    const typeConfig = primaryPort ? getPortTypeConfig(primaryPort.dataType) : null;

    // Only output ports (right side) can initiate wire drags
    const canDrag = side === 'right';

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Only allow dragging from OUTPUT ports (right side)
        if (!canDrag) return;

        e.stopPropagation();
        e.preventDefault();

        const rect = handleRef.current?.getBoundingClientRect();
        if (!rect) return;

        const startX = rect.left + rect.width / 2;
        const startY = rect.top + rect.height / 2;

        setDragState({
            isDragging: true,
            startX,
            startY,
            currentX: e.clientX,
            currentY: e.clientY
        });

        // Add window event listeners
        const handleMouseMove = (moveE: MouseEvent) => {
            setDragState(prev => prev ? {
                ...prev,
                currentX: moveE.clientX,
                currentY: moveE.clientY
            } : null);
        };

        const handleMouseUp = (upE: MouseEvent) => {
            // Check if we dropped on any block's input port (left side)
            const targetElement = document.elementFromPoint(upE.clientX, upE.clientY);

            // Look for wire-port-target class (left port on any block)
            const wireTarget = targetElement?.closest('.wire-port-target');
            let targetBlockId: string | null = null;

            if (wireTarget) {
                // Get block ID from the data attribute on the port
                targetBlockId = wireTarget.getAttribute('data-block-id');
            }

            // Fallback: Check if dropped anywhere on a block card
            if (!targetBlockId) {
                const blockCard = targetElement?.closest('.block-card');
                if (blockCard) {
                    // Try to find a wire-port-target inside this block
                    const portInBlock = blockCard.querySelector('.wire-port-target');
                    if (portInBlock) {
                        targetBlockId = portInBlock.getAttribute('data-block-id');
                    }
                    // Also check for data-persona-block (legacy)
                    if (!targetBlockId) {
                        const personaData = blockCard.querySelector('[data-persona-block]');
                        if (personaData) {
                            targetBlockId = personaData.getAttribute('data-block-id');
                        }
                    }
                }
            }

            if (targetBlockId && targetBlockId !== blockId) {
                // Create wire from this block (source/output) to target block (input)
                wireService.createWire(blockId, targetBlockId);
            }

            setDragState(null);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [blockId, canDrag]);


    // ALL blocks now have BOTH handles for full modular data pipelines
    // - Left handle = Input (receives data from other blocks) - DROP TARGET ONLY
    // - Right handle = Output (sends data to other blocks) - DRAG SOURCE
    // This enables: API → Mind → Media block chains

    const isConnected = connectionCount > 0;

    // Calculate bezier curve path for drag line
    const getDragPath = () => {
        if (!dragState) return '';
        const { startX, startY, currentX, currentY } = dragState;
        const controlOffset = Math.min(100, Math.abs(currentX - startX) / 2);
        return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${currentX - controlOffset} ${currentY}, ${currentX} ${currentY}`;
    };

    return (
        <>
            {/* Unified Port Handle */}
            <div
                ref={handleRef}
                onMouseDown={handleMouseDown}
                onMouseEnter={() => setIsHovering(true)}
                onMouseLeave={() => setIsHovering(false)}
                data-block-id={side === 'left' ? blockId : undefined}
                className={cn(
                    "wire-port absolute top-1/2 -translate-y-1/2 z-20",
                    "flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-all",
                    side === 'right' ? "wire-port-source -right-4 cursor-grab active:cursor-grabbing" : "wire-port-target -left-4 cursor-crosshair",
                    isHovering && "scale-110"
                )}
                style={{
                    backgroundColor: isHovering
                        ? typeConfig ? `${typeConfig.color}30` : 'rgba(99, 102, 241, 0.2)'
                        : 'rgba(0, 0, 0, 0.6)',
                    color: typeConfig?.color || 'var(--citadel-primary)',
                    backdropFilter: 'blur(8px)',
                    border: `1px solid ${typeConfig?.color || 'var(--citadel-primary)'}40`
                }}
            >
                {/* Port Type Icon */}
                <span className="text-base leading-none">
                    {typeConfig?.icon || <Plug className="w-4 h-4" />}
                </span>

                {/* Connection Count Badge */}
                {isConnected && (
                    <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold"
                        style={{
                            backgroundColor: typeConfig?.color || 'var(--citadel-primary)',
                            color: '#000'
                        }}
                    >
                        {connectionCount}
                    </motion.span>
                )}
            </div>

            {/* Rich Tooltip on Hover */}
            <AnimatePresence>
                {isHovering && !dragState && primaryPort && (
                    <motion.div
                        initial={{ opacity: 0, x: side === 'left' ? 8 : -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: side === 'left' ? 8 : -8 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-50 pointer-events-none"
                        style={{
                            top: '50%',
                            transform: 'translateY(-50%)',
                            [side === 'left' ? 'right' : 'left']: '100%',
                            [side === 'left' ? 'marginRight' : 'marginLeft']: '16px',
                            minWidth: '200px'
                        }}
                    >
                        <div
                            className="px-3 py-2 rounded-lg text-xs backdrop-blur-xl border shadow-xl"
                            style={{
                                backgroundColor: 'rgba(0, 0, 0, 0.95)',
                                borderColor: `${typeConfig!.color}60`
                            }}
                        >
                            <div className="flex items-center gap-2 mb-1.5">
                                <span className="text-base">{typeConfig!.icon}</span>
                                <span className="font-semibold text-white">
                                    {typeConfig!.label} {primaryPort.direction === 'input' ? 'Input' : 'Output'}
                                </span>
                            </div>
                            <div className="text-gray-300 text-[11px] space-y-0.5">
                                {primaryPort.label && <div>• {primaryPort.label}</div>}
                                {primaryPort.description && <div>• {primaryPort.description}</div>}
                                <div>• Type: <span className="font-mono">{primaryPort.dataType}</span></div>
                                {isConnected && (
                                    <div className="mt-1 font-medium" style={{ color: typeConfig!.color }}>
                                        ✓ {connectionCount} connection{connectionCount !== 1 ? 's' : ''}
                                    </div>
                                )}
                                <div className="mt-1.5 text-blue-400 text-[10px]">
                                    {side === 'right' ? '→ Drag to connect' : '← Drop wire here'}
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Drag line visualization - Bezier curve */}
            {dragState && (
                <svg
                    className="fixed inset-0 pointer-events-none z-50"
                    style={{ width: '100vw', height: '100vh' }}
                >
                    <defs>
                        <linearGradient id="drag-wire-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="var(--citadel-primary)" />
                            <stop offset="100%" stopColor="var(--mind-aqua-surface)" />
                        </linearGradient>
                        <filter id="drag-glow" x="-50%" y="-50%" width="200%" height="200%">
                            <feGaussianBlur stdDeviation="3" result="blur" />
                            <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>
                    {/* Bezier curve path */}
                    <motion.path
                        d={getDragPath()}
                        fill="none"
                        stroke="url(#drag-wire-gradient)"
                        strokeWidth={3}
                        strokeDasharray="8,4"
                        strokeLinecap="round"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        style={{ filter: 'url(#drag-glow)' }}
                    />
                    {/* Endpoint circle */}
                    <motion.circle
                        cx={dragState.currentX}
                        cy={dragState.currentY}
                        r={8}
                        fill="var(--citadel-primary)"
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        style={{ filter: 'url(#drag-glow)' }}
                    />
                    {/* Arrow indicator at cursor */}
                    <motion.polygon
                        points={`${dragState.currentX},${dragState.currentY - 12} ${dragState.currentX - 6},${dragState.currentY - 20} ${dragState.currentX + 6},${dragState.currentY - 20}`}
                        fill="var(--citadel-primary)"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.8 }}
                    />
                </svg>
            )}
        </>
    );
}

/**
 * Wire target indicator - shows on persona blocks when wire is being dragged
 */
export function WireTarget({ blockId }: { blockId: string }) {
    return (
        <div
            data-persona-block="true"
            data-block-id={blockId}
            className="absolute inset-0 pointer-events-auto"
        />
    );
}

export default WireHandle;
