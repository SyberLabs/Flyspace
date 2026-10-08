// Circuit-style wire routing for the canvas.
//
//   routeWires(blocks, wires) -> one orthogonal polyline per wire
//
// 1. Every block is inflated by `clearance` and becomes an obstacle (a wire's
//    own source and target blocks too: only the port stub touches them).
// 2. A sparse orthogonal grid is built from the obstacle edges, channel
//    midpoints and port rows; each wire is an A* search over it where
//    cost = length + bend penalty + crossing penalty + corridor-sharing penalty.
//    Wires are routed shortest-first, in a fixed order, so the result is
//    deterministic: the same layout always gives the same wires.
// 3. Wires into one input share one trunk, wires out of one output one bundle
//    (`snapShared`); overlapping runs of different nets are nudged into lanes
//    (`nudge.ts`); crossings get a hop and split/merge points a junction dot.
//
// `WireRouter` adds a live mode for dragging: only the wires that touch the
// moving block, or whose settled path it now runs into, are searched again.
//
// Pure and framework-free: no React, no DOM, no stores.

import { GridSearch, indexOf, RoutingGrid, type Obstacle } from './grid';
import { nudge, simplify } from './nudge';
import {
    DEFAULT_ROUTE_OPTIONS,
    type Junction,
    type Point,
    type RouteBlock,
    type RouteOptions,
    type RouteResult,
    type RouteWire,
    type RoutedWire
} from './types';

export * from './types';
export { polylineToPath, midpoint, DEFAULT_PATH_STYLE } from './svgPath';

const EPS = 1e-6;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Ends {
    wire: RouteWire;
    /** Port points: where the wire leaves the source handle and enters the target handle. */
    ps: Point;
    pt: Point;
    source: RouteBlock;
    target: RouteBlock;
}

function inflate(b: RouteBlock, by: number): Obstacle {
    return { l: b.x - by, t: b.y - by, r: b.x + b.width + by, b: b.y + b.height + by };
}

function strictlyInside(o: Obstacle, p: Point): boolean {
    return p.x > o.l + EPS && p.x < o.r - EPS && p.y > o.t + EPS && p.y < o.b - EPS;
}

/** True when the axis-aligned segment a-b passes through the interior of o. */
export function segmentHits(o: Obstacle, a: Point, b: Point): boolean {
    if (Math.abs(a.y - b.y) < EPS) {
        if (!(a.y > o.t + EPS && a.y < o.b - EPS)) return false;
        return Math.min(Math.max(a.x, b.x), o.r) - Math.max(Math.min(a.x, b.x), o.l) > EPS;
    }
    if (!(a.x > o.l + EPS && a.x < o.r - EPS)) return false;
    return Math.min(Math.max(a.y, b.y), o.b) - Math.max(Math.min(a.y, b.y), o.t) > EPS;
}

function pathHits(o: Obstacle, points: Point[]): boolean {
    for (let k = 0; k + 1 < points.length; k++) if (segmentHits(o, points[k], points[k + 1])) return true;
    return false;
}

/** A plain elbow, used only when no clear path exists (e.g. a port walled in by overlapping blocks). */
function elbow(e: Ends, opts: RouteOptions): Point[] {
    const ax = e.ps.x + opts.stub;
    const bx = e.pt.x - opts.stub;
    if (bx >= ax) {
        const mx = (ax + bx) / 2;
        return simplify([e.ps, { x: mx, y: e.ps.y }, { x: mx, y: e.pt.y }, e.pt]);
    }
    const below = Math.max(e.source.y + e.source.height, e.target.y + e.target.height) + opts.clearance + opts.stub;
    return simplify([e.ps, { x: ax, y: e.ps.y }, { x: ax, y: below }, { x: bx, y: below }, { x: bx, y: e.pt.y }, e.pt]);
}

function same(a: Point, b: Point): boolean {
    return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

function manhattan(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Index in a grid path where the final approach (last vertical run, then the run east) begins. */
function trunkStart(path: number[], nx: number): number {
    const row = (n: number) => Math.floor(n / nx);
    let k = path.length - 1;
    while (k > 0 && row(path[k - 1]) === row(path[k])) k--;
    while (k > 0 && row(path[k - 1]) !== row(path[k])) k--;
    return k;
}

/** Where two polylines that start together part ways (null if they never share a run). */
export function splitPoint(a: Point[], b: Point[]): Point | null {
    if (a.length < 2 || b.length < 2 || !same(a[0], b[0])) return null;
    let cur = a[0];
    let ia = 1;
    let ib = 1;
    while (ia < a.length && ib < b.length) {
        const na = a[ia];
        const nb = b[ib];
        const da = manhattan(cur, na);
        const db = manhattan(cur, nb);
        const ua = { x: (na.x - cur.x) / (da || 1), y: (na.y - cur.y) / (da || 1) };
        const ub = { x: (nb.x - cur.x) / (db || 1), y: (nb.y - cur.y) / (db || 1) };
        if (!same(ua, ub)) return same(cur, a[0]) ? null : cur;
        if (Math.abs(da - db) < EPS) {
            cur = na;
            ia++;
            ib++;
        } else if (da < db) {
            cur = na;
            ia++;
        } else {
            cur = nb;
            ib++;
        }
    }
    return null;
}

/** Hops: where a horizontal run of one wire crosses a vertical run of another (not of the same output or input). */
function crossings(polys: Point[][], sources: string[], targets: string[]): Point[][] {
    type Seg = { w: number; a: Point; b: Point };
    const hs: Seg[] = [];
    const vs: Seg[] = [];
    polys.forEach((p, w) => {
        for (let k = 0; k + 1 < p.length; k++) {
            const seg = { w, a: p[k], b: p[k + 1] };
            if (Math.abs(p[k].y - p[k + 1].y) < EPS) hs.push(seg);
            else vs.push(seg);
        }
    });
    const hops: Point[][] = polys.map(() => []);
    for (const h of hs) {
        const x0 = Math.min(h.a.x, h.b.x);
        const x1 = Math.max(h.a.x, h.b.x);
        const y = h.a.y;
        for (const v of vs) {
            if (v.w === h.w || sources[v.w] === sources[h.w] || targets[v.w] === targets[h.w]) continue;
            const x = v.a.x;
            const y0 = Math.min(v.a.y, v.b.y);
            const y1 = Math.max(v.a.y, v.b.y);
            if (x > x0 + 1 && x < x1 - 1 && y > y0 + 1 && y < y1 - 1) hops[h.w].push({ x, y });
        }
    }
    return hops;
}

/**
 * Move one vertical run of a polyline to a new x, if the moved run and the two
 * runs it joins stay clear of every obstacle and keep their direction.
 * `k` is the index of the run's first point. Returns the new polyline or null.
 */
function moveVertical(points: Point[], k: number, x: number, obstacles: Obstacle[], minFirstRun: number): Point[] | null {
    const a = points[k];
    const b = points[k + 1];
    if (Math.abs(a.x - b.x) > EPS || Math.abs(a.x - x) < EPS) return null;
    const prev = points[k - 1];
    const next = points[k + 2];
    if (!prev || !next) return null;
    // Keep each neighbouring horizontal run pointing the way it did.
    if (Math.sign(x - prev.x) !== Math.sign(a.x - prev.x) && Math.abs(x - prev.x) > EPS) return null;
    if (Math.sign(next.x - x) !== Math.sign(next.x - b.x) && Math.abs(next.x - x) > EPS) return null;
    if (k === 1 && x - prev.x < minFirstRun) return null;
    if (k + 2 === points.length - 1 && next.x - x < minFirstRun) return null;
    const moved = points.slice();
    moved[k] = { x, y: a.y };
    moved[k + 1] = { x, y: b.y };
    for (const o of obstacles) {
        if (segmentHits(o, prev, moved[k]) || segmentHits(o, moved[k], moved[k + 1]) || segmentHits(o, moved[k + 1], next)) {
            return null;
        }
    }
    return moved;
}

/**
 * Wires into one input should run down one trunk; wires out of one output
 * should leave on one bundle. The search usually finds that by itself; this
 * pass moves the stragglers' last (or first) vertical run onto the line most
 * of their group already uses, when that is clear.
 */
function snapShared(raw: Point[][], ends: Ends[], obstacles: Obstacle[], ignored: Obstacle[][], opts: RouteOptions): void {
    const groups = (key: (e: Ends) => string) => {
        const map = new Map<string, number[]>();
        ends.forEach((e, i) => {
            const k = key(e);
            map.set(k, [...(map.get(k) ?? []), i]);
        });
        return [...map.values()].filter(g => g.length > 1);
    };
    const snap = (group: number[], runIndex: (p: Point[]) => number) => {
        const lines = [...new Set(group.flatMap(i => {
            const k = runIndex(raw[i]);
            return k < 1 ? [] : [raw[i][k].x];
        }))].sort((p, q) => p - q);
        if (lines.length < 2) return;
        // Pick the line the most wires can share (already on it, or movable onto it).
        let best: { x: number; moves: Map<number, Point[]>; count: number } | null = null;
        for (const x of lines) {
            const moves = new Map<number, Point[]>();
            let count = 0;
            for (const i of group) {
                const k = runIndex(raw[i]);
                if (k < 1) continue;
                if (Math.abs(raw[i][k].x - x) < EPS) {
                    count++;
                    continue;
                }
                const walls = obstacles.filter(o => !ignored[i].includes(o));
                const moved = moveVertical(raw[i], k, x, walls, opts.stub);
                if (moved) {
                    moves.set(i, moved);
                    count++;
                }
            }
            if (!best || count > best.count) best = { x, moves, count };
        }
        if (!best || best.count < 2) return;
        for (const [i, moved] of best.moves) raw[i] = simplify(moved);
    };
    // Last vertical run: the run before the final horizontal one.
    for (const group of groups(e => e.wire.target)) snap(group, p => (p.length >= 4 ? p.length - 3 : -1));
    // First vertical run: the run after the source stub.
    for (const group of groups(e => e.wire.source)) snap(group, p => (p.length >= 4 ? 1 : -1));
}

interface CoreOutput {
    result: RouteResult;
    /** Each wire's path before lanes were assigned, by wire id. Cached by `WireRouter`. */
    raw: Map<string, Point[]>;
}

function endsOf(blocks: RouteBlock[], wires: RouteWire[], opts: RouteOptions): Ends[] {
    const byId = new Map(blocks.map(b => [b.id, b]));
    // Work in id order so the input order of wires cannot change the result.
    const sorted = [...wires].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const ends: Ends[] = [];
    for (const wire of sorted) {
        const source = byId.get(wire.source);
        const target = byId.get(wire.target);
        if (!source || !target) continue;
        ends.push({
            wire,
            source,
            target,
            ps: { x: source.x + source.width + opts.portOutset, y: source.y + source.height / 2 },
            pt: { x: target.x - opts.portOutset, y: target.y + target.height / 2 }
        });
    }
    return ends;
}

function routeCore(
    blocks: RouteBlock[],
    wires: RouteWire[],
    opts: RouteOptions,
    reuse: (e: Ends) => Point[] | undefined
): CoreOutput {
    const ends = endsOf(blocks, wires, opts);
    if (ends.length === 0) {
        const stats = { gridLines: [0, 0] as [number, number], expansions: 0, ms: { grid: 0, search: 0, finish: 0 } };
        return { result: { wires: [], junctions: [], stats }, raw: new Map() };
    }

    const t0 = now();
    const obstacles = blocks.map(b => inflate(b, opts.clearance));
    const grid = new RoutingGrid(obstacles, ends.flatMap(e => [e.ps.y, e.pt.y]), opts.clearance + opts.stub);
    const search = new GridSearch(grid);
    const costs = {
        bend: opts.bendPenalty,
        cross: opts.crossPenalty,
        share: opts.sharePenalty,
        greed: opts.greed,
        reserve: STUB_RESERVE
    };
    const t1 = now();

    // Net tags: one per source block (its bundle), one per target block (its trunk).
    const tagOf = new Map<string, number>();
    const tag = (key: string) => {
        let t = tagOf.get(key);
        if (t === undefined) tagOf.set(key, (t = tagOf.size + 1));
        return t;
    };

    // Shortest first; the id-sorted index breaks ties. A fixed order keeps the result deterministic.
    const order = ends
        .map((_, i) => i)
        .sort((a, b) => manhattan(ends[a].ps, ends[a].pt) - manhattan(ends[b].ps, ends[b].pt) || a - b);

    const raw: Point[][] = new Array(ends.length);
    const routed: boolean[] = new Array(ends.length).fill(false);
    const ignored: Obstacle[][] = new Array(ends.length);
    const row = (y: number) => indexOf(grid.ys, y);

    // Where each wire's search starts and ends: no sooner than `stub` past the
    // port (on the first grid line out there), or sooner if a neighbouring
    // block leaves less room. Each stub is kept for its own net, so no other
    // wire runs along it or cuts across it right in front of a port.
    const plan = ends.map(e => {
        const sj = row(e.ps.y);
        const tj = row(e.pt.y);
        const si = grid.stubEnd(e.ps.x, sj, 1, opts.stub);
        const ti = grid.stubEnd(e.pt.x, tj, -1, opts.stub);
        const srcTag = tag(`<${e.wire.source}`);
        const dstTag = tag(`>${e.wire.target}`);
        grid.reserveStub(sj, grid.lineAtOrAfter(e.ps.x), si, srcTag);
        grid.reserveStub(tj, grid.lineAtOrBefore(e.pt.x), ti, dstTag);
        return { start: grid.node(si, sj), goal: grid.node(ti, tj), srcTag, dstTag };
    });

    for (const i of order) {
        const e = ends[i];
        const { start, goal, srcTag, dstTag } = plan[i];
        const as = grid.point(start);
        const at = grid.point(goal);
        // A port walled in by an overlapping block may pass through that block.
        ignored[i] = obstacles.filter(o => strictlyInside(o, as) || strictlyInside(o, at));
        const kept = reuse(e);
        if (kept) {
            raw[i] = kept;
            routed[i] = true;
            continue;
        }
        const path = search.find(start, goal, srcTag, dstTag, costs, ignored[i]);
        if (path) {
            const from = trunkStart(path, grid.nx);
            grid.occupy(path, path.map((_, k) => (k >= from ? dstTag : srcTag)));
            raw[i] = simplify([e.ps, ...path.map(n => grid.point(n)), e.pt]);
            routed[i] = true;
        } else {
            raw[i] = elbow(e, opts);
        }
    }

    const t2 = now();
    snapShared(raw, ends, obstacles, ignored, opts);
    const rawById = new Map(ends.map((e, i) => [e.wire.id, raw[i]]));

    // The final approach (last vertical run and the run into the port) is the
    // target's trunk; everything before it is the source's bundle.
    const segNets = raw.map((p, i) => {
        const segs = p.length - 1;
        const trunk = segs >= 2 ? segs - 2 : 0;
        return Array.from({ length: segs }, (_, k) => (k >= trunk ? `>${ends[i].wire.target}` : `<${ends[i].wire.source}`));
    });
    const points = nudge(raw.map((p, i) => ({ points: p, nets: segNets[i] })), blocks, opts);
    const hops = crossings(points, ends.map(e => e.wire.source), ends.map(e => e.wire.target));

    // Junction dots: an output's wires splitting, and wires joining an input's trunk.
    const junctions: Junction[] = [];
    const seen = new Set<string>();
    const addJunction = (a: number, b: number, p: Point | null) => {
        if (!p) return;
        const key = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
        if (seen.has(key)) return;
        seen.add(key);
        junctions.push({ x: p.x, y: p.y, wires: [ends[a].wire.id, ends[b].wire.id] });
    };
    const bySource = new Map<string, number[]>();
    const byTarget = new Map<string, number[]>();
    ends.forEach((e, i) => {
        bySource.set(e.wire.source, [...(bySource.get(e.wire.source) ?? []), i]);
        byTarget.set(e.wire.target, [...(byTarget.get(e.wire.target) ?? []), i]);
    });
    for (const group of bySource.values()) {
        for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
                addJunction(group[a], group[b], splitPoint(points[group[a]], points[group[b]]));
            }
        }
    }
    for (const group of byTarget.values()) {
        for (let a = 0; a < group.length; a++) {
            for (let b = a + 1; b < group.length; b++) {
                addJunction(group[a], group[b], splitPoint([...points[group[a]]].reverse(), [...points[group[b]]].reverse()));
            }
        }
    }

    const byWire = new Map<string, RoutedWire>(ends.map((e, i) => [e.wire.id, {
        id: e.wire.id,
        source: e.wire.source,
        target: e.wire.target,
        points: points[i],
        hops: hops[i],
        routed: routed[i]
    }]));
    // Hand the wires back in the caller's order.
    const result = wires.map(w => byWire.get(w.id)).filter((w): w is RoutedWire => !!w);
    return {
        result: {
            wires: result,
            junctions,
            stats: {
                gridLines: [grid.nx, grid.ny],
                expansions: search.expansions,
                ms: { grid: t1 - t0, search: t2 - t1, finish: now() - t2 }
            }
        },
        raw: rawById
    };
}

/** Route every wire from scratch. Deterministic: the same layout always gives the same wires. */
export function routeWires(blocks: RouteBlock[], wires: RouteWire[], options: Partial<RouteOptions> = {}): RouteResult {
    return routeCore(blocks, wires, { ...DEFAULT_ROUTE_OPTIONS, ...options }, () => undefined).result;
}

const LIVE_GREED = 2;

/** Cost of using another net's port stub: about ten bends, so only a last resort. */
const STUB_RESERVE = 360;

function rectKey(b: RouteBlock): string {
    return `${b.x},${b.y},${b.width},${b.height}`;
}

/**
 * Stateful router for the canvas. `route` is a full, deterministic route and
 * remembers each wire's path. `routeLive` is for drag frames: it keeps every
 * remembered path that the moving block neither owns nor runs into, and
 * searches only the rest, so near wires make room while far ones stay put.
 * A full `route` on drop settles everything again.
 */
export class WireRouter {
    private settled = new Map<string, { points: Point[]; key: string }>();
    private readonly opts: RouteOptions;

    constructor(options: Partial<RouteOptions> = {}) {
        this.opts = { ...DEFAULT_ROUTE_OPTIONS, ...options };
    }

    route(blocks: RouteBlock[], wires: RouteWire[]): RouteResult {
        const out = routeCore(blocks, wires, this.opts, () => undefined);
        const byId = new Map(blocks.map(b => [b.id, b]));
        this.settled.clear();
        for (const w of wires) {
            const points = out.raw.get(w.id);
            const s = byId.get(w.source);
            const t = byId.get(w.target);
            if (points && s && t) this.settled.set(w.id, { points, key: `${rectKey(s)}|${rectKey(t)}` });
        }
        return out.result;
    }

    routeLive(blocks: RouteBlock[], wires: RouteWire[], movingId: string): RouteResult {
        const moving = blocks.find(b => b.id === movingId);
        if (!moving) return this.route(blocks, wires);
        const zone = inflate(moving, this.opts.clearance);
        // A greedier search keeps drag frames cheap; the drop re-routes at full quality.
        const live = { ...this.opts, greed: Math.max(this.opts.greed, LIVE_GREED) };
        return routeCore(blocks, wires, live, e => {
            if (e.wire.source === movingId || e.wire.target === movingId) return undefined;
            const kept = this.settled.get(e.wire.id);
            if (!kept || kept.key !== `${rectKey(e.source)}|${rectKey(e.target)}`) return undefined;
            return pathHits(zone, kept.points) ? undefined : kept.points;
        }).result;
    }
}
