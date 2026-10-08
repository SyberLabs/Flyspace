// Lane assignment ("nudging"). After routing, wires of different nets often
// share a grid line. Collinear overlapping segments are spread into parallel
// lanes `laneGap` apart, ordered so that a wire turning off a corridor sits
// on the side it turns to (which avoids needless crossings). Segments of the
// same net share one lane: an output's wires bundle then split, and the final
// approach of wires into one input is one trunk they join. A lane that still
// lands on a port row off-centre jogs onto the port just before it.

import type { Point, RouteBlock, RouteOptions } from './types';

export interface NetPolyline {
    points: Point[];
    /** Net of each segment (points[k] -> points[k + 1]). Same net = same lane. */
    nets: string[];
}

interface Segment {
    w: number;
    k: number;
    horizontal: boolean;
    coord: number;
    lo: number;
    hi: number;
    net: string;
    /** Side the wire turns to at the low / high end: -1 up or left, +1 down or right, 0 a port. */
    sideLo: number;
    sideHi: number;
    /** Tie-break: the coordinate of the wire's far endpoint across the lane axis. */
    far: number;
}

const EPS = 1e-6;

/** Drop repeated points and merge collinear runs. */
export function simplify(points: Point[]): Point[] {
    const out: Point[] = [];
    for (const p of points) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
        out.push(p);
        while (out.length >= 3) {
            const a = out[out.length - 3];
            const b = out[out.length - 2];
            const c = out[out.length - 1];
            const sameX = Math.abs(a.x - b.x) < EPS && Math.abs(b.x - c.x) < EPS;
            const sameY = Math.abs(a.y - b.y) < EPS && Math.abs(b.y - c.y) < EPS;
            if (!sameX && !sameY) break;
            out.splice(out.length - 2, 1);
        }
    }
    return out;
}

function segmentsOf(wires: NetPolyline[]): Segment[] {
    const segs: Segment[] = [];
    wires.forEach((wire, w) => {
        const p = wire.points;
        const last = p.length - 2;
        for (let k = 0; k <= last; k++) {
            const a = p[k];
            const b = p[k + 1];
            const horizontal = Math.abs(a.y - b.y) < EPS;
            const along = (q: Point) => (horizontal ? q.x : q.y);
            const across = (q: Point) => (horizontal ? q.y : q.x);
            // Side the neighbouring segment leaves toward, at each end.
            const sideAtA = k > 0 ? Math.sign(across(p[k - 1]) - across(a)) : 0;
            const sideAtB = k < last ? Math.sign(across(p[k + 2]) - across(b)) : 0;
            const aIsLo = along(a) <= along(b);
            const end = p[p.length - 1];
            const start = p[0];
            segs.push({
                w,
                k,
                horizontal,
                coord: across(a),
                lo: Math.min(along(a), along(b)),
                hi: Math.max(along(a), along(b)),
                net: wire.nets[k],
                sideLo: aIsLo ? sideAtA : sideAtB,
                sideHi: aIsLo ? sideAtB : sideAtA,
                far: horizontal ? (Math.abs(start.y - a.y) > Math.abs(end.y - a.y) ? start.y : end.y)
                    : (Math.abs(start.x - a.x) > Math.abs(end.x - a.x) ? start.x : end.x)
            });
        }
    });
    return segs;
}

/** Negative: a belongs on the low side (above / left) of b. */
function vote(a: Segment, b: Segment): number {
    let v = 0;
    // High end: whichever ends first turns off; it belongs on the side it turns to.
    if (Math.abs(a.hi - b.hi) > EPS) {
        v += a.hi < b.hi ? a.sideHi : -b.sideHi;
    }
    // Low end: whichever starts later joined from a side; it belongs on that side.
    if (Math.abs(a.lo - b.lo) > EPS) {
        v += a.lo > b.lo ? a.sideLo : -b.sideLo;
    }
    return v;
}

interface Lane {
    net: string;
    segs: Segment[];
}

function compareLanes(a: Lane, b: Lane): number {
    let v = 0;
    for (const sa of a.segs) {
        for (const sb of b.segs) {
            if (Math.min(sa.hi, sb.hi) - Math.max(sa.lo, sb.lo) > 0.5) v += vote(sa, sb);
        }
    }
    if (v !== 0) return v;
    // Otherwise keep the order the lines already had, then look at where each wire is headed.
    const ca = a.segs.reduce((s, x) => s + x.coord, 0) / a.segs.length;
    const cb = b.segs.reduce((s, x) => s + x.coord, 0) / b.segs.length;
    if (Math.abs(ca - cb) > EPS) return ca - cb;
    const fa = a.segs.reduce((s, x) => s + x.far, 0) / a.segs.length;
    const fb = b.segs.reduce((s, x) => s + x.far, 0) / b.segs.length;
    if (Math.abs(fa - fb) > EPS) return fa - fb;
    return a.net < b.net ? -1 : a.net > b.net ? 1 : 0;
}

/** Free band across a corridor line, bounded by the nearest blocks on each side. */
function band(horizontal: boolean, coord: number, lo: number, hi: number, blocks: RouteBlock[], clearance: number): [number, number] {
    let min = -Infinity;
    let max = Infinity;
    for (const b of blocks) {
        const alongLo = horizontal ? b.x : b.y;
        const alongHi = horizontal ? b.x + b.width : b.y + b.height;
        if (alongHi <= lo || alongLo >= hi) continue;
        const acrossLo = horizontal ? b.y : b.x;
        const acrossHi = horizontal ? b.y + b.height : b.x + b.width;
        if (acrossHi <= coord + EPS) min = Math.max(min, acrossHi + clearance);
        else if (acrossLo >= coord - EPS) max = Math.min(max, acrossLo - clearance);
    }
    return [min, max];
}

/**
 * Spread overlapping collinear segments of different nets into lanes.
 * Returns new polylines; ports (first and last points) never move.
 */
export function nudge(wires: NetPolyline[], blocks: RouteBlock[], opts: RouteOptions): Point[][] {
    const segs = segmentsOf(wires);
    const offset = new Map<Segment, number>();

    // Cluster parallel segments that overlap along their run and sit closer
    // than one lane gap: they share a corridor (the same grid line, or a
    // channel edge and its midpoint) and must be laned together.
    const parent = segs.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const horizontal of [true, false]) {
        const idx = segs.map((_, i) => i).filter(i => segs[i].horizontal === horizontal);
        idx.sort((p, q) => segs[p].coord - segs[q].coord || p - q);
        for (let x = 0; x < idx.length; x++) {
            const a = segs[idx[x]];
            for (let y = x + 1; y < idx.length; y++) {
                const b = segs[idx[y]];
                if (b.coord - a.coord >= opts.laneGap - EPS) break;
                if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.5) parent[find(idx[y])] = find(idx[x]);
            }
        }
    }
    const clusters = new Map<number, Segment[]>();
    segs.forEach((s, i) => {
        const root = find(i);
        let c = clusters.get(root);
        if (!c) clusters.set(root, (c = []));
        c.push(s);
    });
    for (const cluster of clusters.values()) {
        if (cluster.length > 1) assignLanes(cluster);
    }

    function assignLanes(comp: Segment[]): void {
        const lanes: Lane[] = [];
        const byNet = new Map<string, Lane>();
        for (const s of comp) {
            let lane = byNet.get(s.net);
            if (!lane) {
                lane = { net: s.net, segs: [] };
                byNet.set(s.net, lane);
                lanes.push(lane);
            }
            lane.segs.push(s);
        }
        const coords = new Set(comp.map(s => s.coord));
        if (lanes.length < 2 && coords.size < 2) return;
        lanes.sort(compareLanes);

        // Centre the lanes on the line carrying the most run length.
        const weight = new Map<number, number>();
        for (const s of comp) weight.set(s.coord, (weight.get(s.coord) ?? 0) + (s.hi - s.lo));
        let center = comp[0].coord;
        let best = -1;
        for (const [c, w] of [...weight.entries()].sort((p, q) => p[0] - q[0])) {
            if (w > best + EPS) {
                best = w;
                center = c;
            }
        }
        const lo = Math.min(...comp.map(s => s.lo));
        const hi = Math.max(...comp.map(s => s.hi));
        const [min, max] = band(comp[0].horizontal, center, lo, hi, blocks, opts.laneClearance);
        const n = lanes.length;
        let gap = opts.laneGap;
        if (n > 1 && Number.isFinite(min) && Number.isFinite(max) && max > min) {
            gap = Math.min(gap, (max - min) / (n - 1));
        }
        const spread = gap * (n - 1);
        let startAt = center - spread / 2;
        if (Number.isFinite(max)) startAt = Math.min(startAt, max - spread);
        if (Number.isFinite(min)) startAt = Math.max(startAt, min);
        lanes.forEach((lane, idx) => {
            for (const s of lane.segs) offset.set(s, startAt + idx * gap - s.coord);
        });
    }

    // Rebuild each polyline from its (possibly moved) segment lines.
    const coordOf = new Map<string, number>();
    for (const s of segs) coordOf.set(`${s.w}:${s.k}`, s.coord + (offset.get(s) ?? 0));

    return wires.map((wire, w) => {
        const p = wire.points;
        if (p.length < 2) return p.slice();
        const segCount = p.length - 1;
        const line = (k: number) => coordOf.get(`${w}:${k}`)!;
        const horizontal = (k: number) => Math.abs(p[k].y - p[k + 1].y) < EPS;
        const out: Point[] = [p[0]];
        const start = p[0];
        const end = p[p.length - 1];

        // Leaving the source port on a moved lane: jog onto it just past the port.
        if (horizontal(0) && Math.abs(line(0) - start.y) > EPS) {
            const nextX = segCount > 1 ? line(1) : end.x;
            let jx = start.x + Math.min(opts.mergeJog, Math.abs(nextX - start.x) / 2) * Math.sign(nextX - start.x || 1);
            if (segCount === 1) jx = start.x + (end.x - start.x) / 3;
            out.push({ x: jx, y: start.y }, { x: jx, y: line(0) });
        }
        for (let k = 1; k < segCount; k++) {
            const a = line(k - 1);
            const b = line(k);
            out.push(horizontal(k - 1) ? { x: b, y: a } : { x: a, y: b });
        }
        // Arriving at the target port on a moved lane: merge into the port trunk.
        const lastK = segCount - 1;
        if (horizontal(lastK) && Math.abs(line(lastK) - end.y) > EPS) {
            const prevX = segCount > 1 ? line(lastK - 1) : start.x;
            let jx = end.x - Math.min(opts.mergeJog, Math.abs(end.x - prevX) / 2) * Math.sign(end.x - prevX || 1);
            if (segCount === 1) jx = end.x - (end.x - start.x) / 3;
            out.push({ x: jx, y: line(lastK) }, { x: jx, y: end.y });
        }
        out.push(end);
        return simplify(out);
    });
}
