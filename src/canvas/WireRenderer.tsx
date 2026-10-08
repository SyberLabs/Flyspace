'use client';

// ============================================
// PROJECT OMNI: WIRE RENDERER
// Circuit-style wires: orthogonal runs that never cross a block, parallel
// runs spread into lanes, hops where two wires must cross, junction dots
// where wires split or join a trunk. Routing lives in ./routing (pure).
// ============================================

import { useMemo, useState, useCallback } from 'react';
import { useWireStore } from '@/core/stores/wireStore';
import { useBlockStore } from '@/core/stores';
import { useUIStore } from '@/core/stores/uiStore';
import { DataWire, WireType } from '@/core/schemas/wire.schema';
import { WireRouter, polylineToPath, midpoint, type RouteBlock, type RouteWire } from './routing';

interface WireRendererProps {
    activeDragId?: string | null;
    dragDelta?: { x: number; y: number } | null;
    shellId?: string;
}

/**
 * Wire type colors (SyberLabs Atlas v2: blue, success, violet, amber)
 */
const WIRE_COLORS: Record<WireType, string> = {
    push: '#4890f0',
    pull: '#6ff5a8',
    contextual: '#9a6bff',
    reactive: '#ffb54a'
};

const STROKE = 1.75;
const STROKE_EMPHASIS = 2.5;
/** Dark casing under each wire so a hop reads as a jump, not a tangle. */
const CASING = 5;

function wireColor(wire: DataWire): string {
    if (wire.status === 'error') return '#ef4444';
    if (wire.status === 'stale') return '#f59e0b';
    if (wire.status === 'disconnected') return '#6b7280';
    return WIRE_COLORS[wire.wireType || 'push'];
}

export function WireRenderer({ activeDragId, dragDelta, shellId }: WireRendererProps) {
    const wires = useWireStore(state => state.wires);
    const getWiresByShell = useWireStore(state => state.getWiresByShell);
    const removeWire = useWireStore(state => state.removeWire);
    const blocks = useBlockStore(state => state.blocks);
    const activeShellId = useBlockStore(state => state.activeShellId);
    const readingWireIds = useUIStore(state => state.readingWireIds);
    const selectedBlockId = useUIStore(state => state.selectedBlockId);

    const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
    // One router per renderer: it remembers settled paths so a drag frame
    // only re-routes the wires the moving block touches or runs into.
    const [router] = useState(() => new WireRouter());

    const currentShell = shellId || activeShellId;

    // Filter wires by shell
    const shellWires = useMemo(() => {
        return currentShell ? getWiresByShell(currentShell) : wires;
    }, [wires, currentShell, getWiresByShell]);

    // Routing depends on geometry only. Block data and status change all the
    // time (fetches, a persona streaming tokens); keying on a geometry string
    // keeps those updates from re-routing every wire.
    const geometryKey = JSON.stringify(blocks
        .filter(b => !currentShell || b.shellId === currentShell)
        .map(b => [b.instance_id, b.position.x, b.position.y, b.dimensions.width, b.dimensions.height]));
    const wiringKey = JSON.stringify(shellWires.map(w => [w.id, w.sourceBlockId, w.targetBlockId]));

    // Every block on this shell is an obstacle; the dragged one where it is now.
    const routeBlocks = useMemo<RouteBlock[]>(() => {
        const rows = JSON.parse(geometryKey) as Array<[string, number, number, number, number]>;
        return rows.map(([id, x, y, width, height]) => {
            const delta = activeDragId === id && dragDelta ? dragDelta : { x: 0, y: 0 };
            return { id, x: x + delta.x, y: y + delta.y, width, height };
        });
    }, [geometryKey, activeDragId, dragDelta]);

    const routeInput = useMemo<RouteWire[]>(() => {
        const rows = JSON.parse(wiringKey) as Array<[string, string, string]>;
        return rows.map(([id, source, target]) => ({ id, source, target }));
    }, [wiringKey]);

    const routing = useMemo(() => {
        return activeDragId
            ? router.routeLive(routeBlocks, routeInput, activeDragId)
            : router.route(routeBlocks, routeInput);
    }, [router, routeBlocks, routeInput, activeDragId]);

    const wirePaths = useMemo(() => {
        const byId = new Map(shellWires.map(w => [w.id, w]));
        const names = new Map(blocks.map(b => [b.instance_id, b.schema.display_name]));
        return routing.wires.flatMap(routed => {
            const wire = byId.get(routed.id);
            if (!wire || routed.points.length < 2) return [];
            const start = routed.points[0];
            const end = routed.points[routed.points.length - 1];
            return [{
                wire,
                path: polylineToPath(routed.points, routed.hops),
                hasHops: routed.hops.length > 0,
                start,
                end,
                mid: midpoint(routed.points),
                sourceName: names.get(wire.sourceBlockId) ?? '',
                targetName: names.get(wire.targetBlockId) ?? ''
            }];
        });
    }, [routing, shellWires, blocks]);

    const handleRemoveWire = useCallback((wireId: string) => {
        if (confirm('Remove this wire?')) {
            removeWire(wireId);
            setHoveredWireId(null);
        }
    }, [removeWire]);

    if (wirePaths.length === 0) return null;

    // Emphasis: the hovered wire, else the selected block's wires. Others recede.
    const focusIds = hoveredWireId
        ? new Set([hoveredWireId])
        : selectedBlockId
            ? new Set(wirePaths
                .filter(p => p.wire.sourceBlockId === selectedBlockId || p.wire.targetBlockId === selectedBlockId)
                .map(p => p.wire.id))
            : null;
    const hasFocus = !!focusIds && focusIds.size > 0;
    const colorById = new Map(wirePaths.map(p => [p.wire.id, wireColor(p.wire)]));

    // Paint order: wires that hop over others go on top so the hop reads; the
    // selected block's wires above those. (Hover does not reorder: moving the
    // node under the pointer would flicker; the hovered wire gets an overlay.)
    const selectedIds = !hoveredWireId ? focusIds : null;
    const ordered = [...wirePaths].sort((a, b) => {
        const fa = selectedIds?.has(a.wire.id) ? 1 : 0;
        const fb = selectedIds?.has(b.wire.id) ? 1 : 0;
        return fa - fb || Number(a.hasHops) - Number(b.hasHops);
    });
    const hovered = hoveredWireId ? wirePaths.find(p => p.wire.id === hoveredWireId) : undefined;

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
            {ordered.map(({ wire, path, start, end }) => {
                const isFocused = !!focusIds?.has(wire.id);
                const isReading = readingWireIds.includes(wire.id);
                const color = colorById.get(wire.id)!;
                const dimmed = hasFocus && !isFocused && !isReading;
                const width = isFocused || isReading ? STROKE_EMPHASIS : STROKE;

                return (
                    <g
                        key={wire.id}
                        data-testid="wire"
                        data-wire-status={wire.status}
                        data-wire-id={wire.id}
                        data-source-id={wire.sourceBlockId}
                        data-target-id={wire.targetBlockId}
                        data-reading={isReading ? 'true' : undefined}
                        style={{ opacity: dimmed ? 0.28 : 1, transition: 'opacity 0.15s ease' }}
                    >
                        {/* Casing: a dark band under the wire */}
                        <path
                            d={path}
                            fill="none"
                            stroke="var(--citadel-void)"
                            strokeWidth={CASING}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />

                        {/* Main wire path */}
                        <path
                            d={path}
                            data-wire-main="true"
                            fill="none"
                            stroke={color}
                            strokeWidth={width}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={isReading ? 'wire-reading' : undefined}
                            style={{ transition: 'stroke-width 0.15s ease' }}
                        />

                        {/* Output end: a small terminal dot */}
                        <circle cx={start.x} cy={start.y} r={2.25} fill={color} />

                        {/* Input end: an arrowhead into the port */}
                        <polygon
                            points={`${end.x},${end.y} ${end.x - 7},${end.y - 3.75} ${end.x - 7},${end.y + 3.75}`}
                            fill={color}
                        />

                        {/* Hover area - wider invisible path */}
                        <path
                            d={path}
                            fill="none"
                            stroke="transparent"
                            strokeWidth={12}
                            style={{ cursor: 'pointer', pointerEvents: 'stroke' }}
                            onMouseEnter={() => setHoveredWireId(wire.id)}
                            onMouseLeave={() => setHoveredWireId(null)}
                            onClick={() => handleRemoveWire(wire.id)}
                        />
                    </g>
                );
            })}

            {/* Junction dots: where wires split from one output or join one input's trunk */}
            {routing.junctions.map(j => {
                const dimmed = hasFocus && !j.wires.some(id => focusIds?.has(id));
                return (
                    <circle
                        key={`${j.x},${j.y}`}
                        data-testid="wire-junction"
                        cx={j.x}
                        cy={j.y}
                        r={3}
                        fill={colorById.get(j.wires[0]) ?? 'var(--citadel-primary)'}
                        stroke="var(--citadel-void)"
                        strokeWidth={1.5}
                        style={{ opacity: dimmed ? 0.28 : 1, transition: 'opacity 0.15s ease' }}
                    />
                );
            })}

            {/* Hovered wire, redrawn on top of everything */}
            {hovered && (
                <path
                    d={hovered.path}
                    fill="none"
                    stroke={colorById.get(hovered.wire.id)}
                    strokeWidth={STROKE_EMPHASIS}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ pointerEvents: 'none', filter: `drop-shadow(0 0 4px ${colorById.get(hovered.wire.id)})` }}
                />
            )}

            {/* Label at midpoint - [Source → Target] */}
            {hovered && (
                <g transform={`translate(${hovered.mid.x}, ${hovered.mid.y})`} style={{ pointerEvents: 'none' }}>
                    <rect
                        x={-80}
                        y={-30}
                        width={160}
                        height={22}
                        rx={4}
                        fill="rgba(0,0,0,0.9)"
                        stroke={colorById.get(hovered.wire.id)}
                        strokeWidth={1}
                    />
                    <text
                        textAnchor="middle"
                        y={-15}
                        fill="white"
                        fontSize={11}
                        fontFamily="system-ui, sans-serif"
                    >
                        {hovered.sourceName} → {hovered.targetName}
                    </text>
                </g>
            )}
        </svg>
    );
}
