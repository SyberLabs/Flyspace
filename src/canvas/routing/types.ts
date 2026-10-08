// Circuit-style wire routing: shared types. Framework-free.

export interface Point {
    x: number;
    y: number;
}

/** A block on the canvas, in canvas coordinates. */
export interface RouteBlock {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/** A wire from a block's output port (right edge) to a block's input port (left edge). */
export interface RouteWire {
    id: string;
    source: string;
    target: string;
}

export interface RouteOptions {
    /** Every block is inflated by this much; no wire runs closer to a block. */
    clearance: number;
    /** Where a wire leaves/enters: this far outside the block edge (the port handle's outer edge). */
    portOutset: number;
    /** Shortest straight run out of a port before the first bend. */
    stub: number;
    /** Distance between parallel wires that share a corridor. */
    laneGap: number;
    /** A nudged lane never comes closer than this to a block. */
    laneClearance: number;
    /** Where lanes converging on one input port merge, measured back from the port. */
    mergeJog: number;
    /** Cost of one bend, in pixels of length. */
    bendPenalty: number;
    /** Cost of crossing another net's wire, in pixels of length. */
    crossPenalty: number;
    /** Extra cost per pixel of corridor already used by another net. */
    sharePenalty: number;
    /**
     * Weighted-A* factor on the search heuristic. 1 finds the cheapest path;
     * above 1 opens far fewer states for paths that are near-cheapest.
     */
    greed: number;
}

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
    clearance: 16,
    portOutset: 16,
    stub: 10,
    laneGap: 8,
    laneClearance: 6,
    mergeJog: 14,
    bendPenalty: 36,
    crossPenalty: 48,
    sharePenalty: 0.4,
    greed: 1.25
};

export interface RoutedWire {
    id: string;
    source: string;
    target: string;
    /** Orthogonal polyline from the source port to the target port. */
    points: Point[];
    /** Where this wire jumps over another (always on one of its horizontal runs). */
    hops: Point[];
    /** False when no clear path exists and a plain elbow was drawn instead. */
    routed: boolean;
}

export interface Junction extends Point {
    /** The two wires that part (or join) here. */
    wires: [string, string];
}

export interface RouteResult {
    wires: RoutedWire[];
    /** Junction dots: where wires from one output split, or wires join an input's trunk. */
    junctions: Junction[];
    /** For measurement: grid lines [x, y], A* states expanded, and time per phase (ms). */
    stats: {
        gridLines: [number, number];
        expansions: number;
        ms: { grid: number; search: number; finish: number };
    };
}
