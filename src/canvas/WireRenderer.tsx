'use client';

// ============================================
// PROJECT OMNI: WIRE RENDERER (Simplified)
// SVG-based wire connections between blocks
// ============================================

import { useMemo, useState, useCallback } from 'react';
import { useWireStore } from '@/core/stores/wireStore';
import { useBlockStore } from '@/core/stores';
import { useUIStore } from '@/core/stores/uiStore';
import { DataWire, WireType } from '@/core/schemas/wire.schema';

interface WireRendererProps {
    activeDragId?: string | null;
    dragDelta?: { x: number; y: number } | null;
    shellId?: string;
}

/**
 * Wire type colors
 */
const WIRE_COLORS: Record<WireType, string> = {
    // One signal colour for every wire (SyberLabs DS: neutral first, one
    // signal). The wire type is named in the label, not encoded in hue.
    push: '#4890F0',
    pull: '#4890F0',
    contextual: '#4890F0',
    reactive: '#4890F0'
};

/**
 * Simplified wire renderer - no animations for performance
 */
export function WireRenderer({ activeDragId, dragDelta, shellId }: WireRendererProps) {
    const wires = useWireStore(state => state.wires);
    const getWiresByShell = useWireStore(state => state.getWiresByShell);
    const removeWire = useWireStore(state => state.removeWire);
    const blocks = useBlockStore(state => state.blocks);
    const activeShellId = useBlockStore(state => state.activeShellId);
    const readingWireIds = useUIStore(state => state.readingWireIds);

    const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);

    const currentShell = shellId || activeShellId;

    // Filter wires by shell
    const shellWires = useMemo(() => {
        return currentShell ? getWiresByShell(currentShell) : wires;
    }, [wires, currentShell, getWiresByShell]);

    // Calculate wire paths
    const wirePaths = useMemo(() => {
        return shellWires.map(wire => {
            const sourceBlock = blocks.find(b => b.instance_id === wire.sourceBlockId);
            const targetBlock = blocks.find(b => b.instance_id === wire.targetBlockId);

            if (!sourceBlock || !targetBlock) return null;

            const sourceDelta = activeDragId === wire.sourceBlockId && dragDelta ? dragDelta : { x: 0, y: 0 };
            const targetDelta = activeDragId === wire.targetBlockId && dragDelta ? dragDelta : { x: 0, y: 0 };

            // Source: right edge center
            const sourceX = sourceBlock.position.x + sourceBlock.dimensions.width + sourceDelta.x;
            const sourceY = sourceBlock.position.y + sourceBlock.dimensions.height / 2 + sourceDelta.y;

            // Target: left edge center
            const targetX = targetBlock.position.x + targetDelta.x;
            const targetY = targetBlock.position.y + targetBlock.dimensions.height / 2 + targetDelta.y;

            // Bezier curve
            const controlOffset = Math.min(80, Math.abs(targetX - sourceX) / 2);
            const path = `M ${sourceX} ${sourceY} C ${sourceX + controlOffset} ${sourceY}, ${targetX - controlOffset} ${targetY}, ${targetX} ${targetY}`;

            // Midpoint
            const midX = (sourceX + targetX) / 2;
            const midY = (sourceY + targetY) / 2;

            return {
                wire,
                path,
                sourceX, sourceY, targetX, targetY, midX, midY,
                sourceName: sourceBlock.schema.display_name,
                targetName: targetBlock.schema.display_name
            };
        }).filter(Boolean) as Array<{
            wire: DataWire;
            path: string;
            sourceX: number;
            sourceY: number;
            targetX: number;
            targetY: number;
            midX: number;
            midY: number;
            sourceName: string;
            targetName: string;
        }>;
    }, [shellWires, blocks, activeDragId, dragDelta]);

    const handleRemoveWire = useCallback((wireId: string) => {
        if (confirm('Remove this wire?')) {
            removeWire(wireId);
        }
    }, [removeWire]);

    if (wirePaths.length === 0) return null;

    const getWireColor = (wire: DataWire) => {
        if (wire.status === 'error') return '#ef4444';
        if (wire.status === 'stale') return '#f59e0b';
        if (wire.status === 'disconnected') return '#6b7280';
        return WIRE_COLORS[wire.wireType || 'push'];
    };

    return (
        <svg
            className="wire-layer"
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 5,
                overflow: 'visible'
            }}
        >
            {wirePaths.map(({ wire, path, targetX, targetY, midX, midY, sourceName, targetName }) => {
                const isHovered = hoveredWireId === wire.id;
                const isReading = readingWireIds.includes(wire.id);
                const color = getWireColor(wire);

                return (
                    <g
                        key={wire.id}
                        data-testid="wire"
                        data-wire-status={wire.status}
                        data-wire-id={wire.id}
                        data-reading={isReading ? 'true' : undefined}
                    >
                        {/* Hover area - wider invisible path */}
                        <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={20}
                            style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                            onMouseEnter={() => setHoveredWireId(wire.id)}
                            onMouseLeave={() => setHoveredWireId(null)}
                            onClick={() => handleRemoveWire(wire.id)}
                        />

                        {/* Main wire path */}
                        <path
                            d={path}
                            fill="none"
                            stroke={color}
                            strokeWidth={isHovered || isReading ? 3 : 2}
                            strokeLinecap="round"
                            className={isReading ? 'wire-reading' : undefined}
                            style={{ transition: 'stroke-width 0.15s ease' }}
                        />

                        {/* Arrow at target */}
                        <polygon
                            points={`${targetX},${targetY} ${targetX - 8},${targetY - 4} ${targetX - 8},${targetY + 4}`}
                            fill={color}
                        />

                        {/* Label at midpoint - [Source → Target] */}
                        {isHovered && (
                            <g transform={`translate(${midX}, ${midY})`}>
                                {/* Background */}
                                <rect
                                    x={-80}
                                    y={-28}
                                    width={160}
                                    height={24}
                                    rx={4}
                                    fill="rgba(0,0,0,0.9)"
                                    stroke={color}
                                    strokeWidth={1}
                                />
                                {/* Text */}
                                <text
                                    textAnchor="middle"
                                    y={-12}
                                    fill="white"
                                    fontSize={11}
                                    fontFamily="system-ui, sans-serif"
                                >
                                    {sourceName} → {targetName}
                                </text>
                            </g>
                        )}
                    </g>
                );
            })}
        </svg>
    );
}

export default WireRenderer;
