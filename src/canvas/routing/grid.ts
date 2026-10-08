// Sparse orthogonal routing grid and the A* search over it.
//
// The grid is a Hanan-style grid: its lines are the inflated block edges, the
// midpoints between neighbouring edges (so wires run down the middle of a
// channel), the port rows, and a frame around everything. Because every
// obstacle edge is a grid line, a grid edge is either wholly inside an
// obstacle or wholly outside it, so blocking is decided once per edge.

import type { Point } from './types';

export interface Obstacle {
    l: number;
    t: number;
    r: number;
    b: number;
}

const EPS = 1e-6;

const MID = 0;
const PORT = 1;
const EDGE = 2;
/** Cost factor per kind of line: wires prefer channel middles to block outlines. */
const LINE_COST = [1, 1.02, 1.06];

function uniqueSorted(values: number[]): number[] {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
        if (out.length === 0 || v - out[out.length - 1] > EPS) out.push(v);
    }
    return out;
}

/**
 * Grid lines along one axis: obstacle edges plus a frame, the midpoint of
 * every gap between them, then the extra (port) lines. Returns each line's
 * kind alongside.
 */
function axisLines(edges: number[], extra: number[], frame: number): { lines: number[]; kind: number[] } {
    const base = uniqueSorted(edges);
    if (base.length) {
        base.unshift(base[0] - frame);
        base.push(base[base.length - 1] + frame);
    }
    const kindOf = new Map<number, number>();
    for (let i = 0; i < base.length; i++) {
        kindOf.set(base[i], EDGE);
        if (i + 1 < base.length && base[i + 1] - base[i] > 2) {
            const m = (base[i] + base[i + 1]) / 2;
            if (!kindOf.has(m)) kindOf.set(m, MID);
        }
    }
    const lines = uniqueSorted([...kindOf.keys(), ...extra]);
    return {
        lines,
        kind: lines.map(v => kindOf.get(v) ?? PORT)
    };
}

export function indexOf(lines: number[], v: number): number {
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
        const m = (lo + hi) >> 1;
        const d = lines[m] - v;
        if (Math.abs(d) <= EPS) return m;
        if (d < 0) lo = m + 1;
        else hi = m - 1;
    }
    return -1;
}

export class RoutingGrid {
    readonly xs: number[];
    readonly ys: number[];
    readonly nx: number;
    readonly ny: number;
    readonly xw: Float64Array;
    readonly yw: Float64Array;
    /** Number of obstacles covering a horizontal / vertical edge. */
    readonly hBlock: Uint16Array;
    readonly vBlock: Uint16Array;
    /** Net occupancy left by already-routed wires: 0 none, a tag, or -1 several. */
    readonly hEdgeNet: Int32Array;
    readonly vEdgeNet: Int32Array;
    readonly hNodeNet: Int32Array;
    readonly vNodeNet: Int32Array;

    constructor(readonly obstacles: Obstacle[], portYs: number[], frame: number) {
        const gx = axisLines(obstacles.flatMap(o => [o.l, o.r]), [], frame);
        const gy = axisLines(obstacles.flatMap(o => [o.t, o.b]), portYs, frame);
        this.xs = gx.lines;
        this.ys = gy.lines;
        this.nx = this.xs.length;
        this.ny = this.ys.length;
        this.xw = Float64Array.from(gx.kind, k => LINE_COST[k]);
        this.yw = Float64Array.from(gy.kind, k => LINE_COST[k]);

        const nx = this.nx;
        const ny = this.ny;
        this.hBlock = new Uint16Array(Math.max(0, nx - 1) * ny);
        this.vBlock = new Uint16Array(nx * Math.max(0, ny - 1));
        this.hEdgeNet = new Int32Array(this.hBlock.length);
        this.vEdgeNet = new Int32Array(this.vBlock.length);
        this.hNodeNet = new Int32Array(nx * ny);
        this.vNodeNet = new Int32Array(nx * ny);

        for (const o of obstacles) {
            const iL = indexOf(this.xs, o.l);
            const iR = indexOf(this.xs, o.r);
            const jT = indexOf(this.ys, o.t);
            const jB = indexOf(this.ys, o.b);
            for (let j = jT + 1; j < jB; j++) {
                for (let i = iL; i < iR; i++) this.hBlock[j * (nx - 1) + i]++;
            }
            for (let i = iL + 1; i < iR; i++) {
                for (let j = jT; j < jB; j++) this.vBlock[j * nx + i]++;
            }
        }
    }

    node(i: number, j: number): number {
        return j * this.nx + i;
    }

    point(node: number): Point {
        return { x: this.xs[node % this.nx], y: this.ys[Math.floor(node / this.nx)] };
    }

    /** Index of the first vertical line at or right of x (the last line if none). */
    lineAtOrAfter(x: number): number {
        const i = this.xs.findIndex(v => v >= x - EPS);
        return i < 0 ? this.nx - 1 : i;
    }

    /** Index of the last vertical line at or left of x (the first line if none). */
    lineAtOrBefore(x: number): number {
        for (let i = this.nx - 1; i >= 0; i--) if (this.xs[i] <= x + EPS) return i;
        return 0;
    }

    /**
     * Where a port's straight stub ends on row `j`: walking from the port's
     * line in direction `step` (+1 east, -1 west), the first line at least
     * `reach` away, or the last one reachable before an obstacle cuts the row.
     */
    stubEnd(fromX: number, j: number, step: 1 | -1, reach: number): number {
        let i = step > 0 ? this.lineAtOrAfter(fromX) : this.lineAtOrBefore(fromX);
        for (;;) {
            if (Math.abs(this.xs[i] - fromX) >= reach - EPS) return i;
            const next = i + step;
            if (next < 0 || next >= this.nx) return i;
            if (this.hBlock[j * (this.nx - 1) + Math.min(i, next)] !== 0) return i;
            i = next;
        }
    }

    /**
     * Record a routed wire's grid path so later wires pay to cross or share
     * it. `tags[k]` is the net tag of the step from path[k] to path[k + 1].
     */
    occupy(path: number[], tags: number[]): void {
        const mark = (arr: Int32Array, k: number, tag: number) => {
            arr[k] = arr[k] === 0 || arr[k] === tag ? tag : -1;
        };
        for (let k = 0; k + 1 < path.length; k++) {
            const a = path[k];
            const b = path[k + 1];
            const tag = tags[k];
            const ja = Math.floor(a / this.nx);
            const jb = Math.floor(b / this.nx);
            if (ja === jb) {
                mark(this.hEdgeNet, ja * (this.nx - 1) + (Math.min(a, b) % this.nx), tag);
                mark(this.hNodeNet, a, tag);
                mark(this.hNodeNet, b, tag);
            } else {
                mark(this.vEdgeNet, Math.min(ja, jb) * this.nx + (a % this.nx), tag);
                mark(this.vNodeNet, a, tag);
                mark(this.vNodeNet, b, tag);
            }
        }
    }
}

// --------------------------------------------
// Binary min-heap on typed arrays. Order: lowest f, then highest g (finish the
// path in hand before opening equal-cost alternatives), then insertion order.
// Every tie is broken, so the search is deterministic.
// --------------------------------------------

class MinHeap {
    private f = new Float64Array(1024);
    private g = new Float64Array(1024);
    private seq = new Uint32Array(1024);
    private val = new Int32Array(1024);
    private n = 0;
    private counter = 0;

    get size(): number {
        return this.n;
    }

    clear(): void {
        this.n = 0;
        this.counter = 0;
    }

    private grow(): void {
        const cap = this.f.length * 2;
        const f = new Float64Array(cap); f.set(this.f); this.f = f;
        const g = new Float64Array(cap); g.set(this.g); this.g = g;
        const q = new Uint32Array(cap); q.set(this.seq); this.seq = q;
        const v = new Int32Array(cap); v.set(this.val); this.val = v;
    }

    private before(fa: number, ga: number, sa: number, b: number): boolean {
        const fb = this.f[b];
        if (fa !== fb) return fa < fb;
        const gb = this.g[b];
        if (ga !== gb) return ga > gb;
        return sa < this.seq[b];
    }

    push(f: number, g: number, val: number): void {
        if (this.n === this.f.length) this.grow();
        const s = this.counter++;
        let i = this.n++;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (!this.before(f, g, s, p)) break;
            this.f[i] = this.f[p]; this.g[i] = this.g[p]; this.seq[i] = this.seq[p]; this.val[i] = this.val[p];
            i = p;
        }
        this.f[i] = f; this.g[i] = g; this.seq[i] = s; this.val[i] = val;
    }

    pop(): number {
        const top = this.val[0];
        const n = --this.n;
        if (n === 0) return top;
        const f = this.f[n];
        const g = this.g[n];
        const s = this.seq[n];
        const v = this.val[n];
        let i = 0;
        for (;;) {
            const l = 2 * i + 1;
            if (l >= n) break;
            const r = l + 1;
            const c = r < n && this.before(this.f[r], this.g[r], this.seq[r], l) ? r : l;
            if (this.before(f, g, s, c)) break;
            this.f[i] = this.f[c]; this.g[i] = this.g[c]; this.seq[i] = this.seq[c]; this.val[i] = this.val[c];
            i = c;
        }
        this.f[i] = f; this.g[i] = g; this.seq[i] = s; this.val[i] = v;
        return top;
    }
}

// Directions of travel: east, west, south, north.
const DI = [1, -1, 0, 0];
const DJ = [0, 0, 1, -1];
const OPPOSITE = [1, 0, 3, 2];
const EAST = 0;
const WEST = 1;
const SOUTH = 2;

export interface SearchCosts {
    bend: number;
    cross: number;
    share: number;
    greed: number;
}

/** Reusable search buffers; sized to the grid. */
export class GridSearch {
    private g: Float64Array;
    private parent: Int32Array;
    private stamp: Uint32Array;
    private closed: Uint32Array;
    private gen = 0;
    private heap = new MinHeap();
    /** States expanded so far (all searches); for measurement. */
    expansions = 0;

    constructor(private grid: RoutingGrid) {
        const states = grid.nx * grid.ny * 4;
        this.g = new Float64Array(states);
        this.parent = new Int32Array(states);
        this.stamp = new Uint32Array(states);
        this.closed = new Uint32Array(states);
    }

    /**
     * Cheapest orthogonal path from `start` (leaving east) to `goal` (leaving
     * east into the target port). Steps on edges already carrying `srcTag` or
     * `dstTag` (this wire's own source bundle or target trunk) are discounted,
     * so wires of one output bundle and wires into one input share a trunk.
     * `ignore` lists obstacles an endpoint sits inside (overlapping blocks);
     * they do not block this wire. Returns grid node indices, or null.
     */
    find(start: number, goal: number, srcTag: number, dstTag: number, costs: SearchCosts, ignore: Obstacle[]): number[] | null {
        const grid = this.grid;
        const { nx, ny, xs, ys, xw, yw, hBlock, vBlock, hEdgeNet, vEdgeNet, hNodeNet, vNodeNet } = grid;
        const gen = ++this.gen;
        const heap = this.heap;
        const gArr = this.g;
        const stamp = this.stamp;
        const closed = this.closed;
        const parent = this.parent;
        heap.clear();
        const gx = xs[goal % nx];
        const gy = ys[Math.floor(goal / nx)];
        const bend = costs.bend;
        const BUNDLE = 0.85;
        // Weighted A*: distance plus the fewest bends still needed to arrive
        // heading east, inflated a little. Paths stay near-shortest; the
        // search opens far fewer states. Fully deterministic.
        const GREED = costs.greed;
        const h = (x: number, y: number, dir: number) => {
            const dx = gx - x;
            const dy = gy - y;
            let bends: number;
            if (dir === EAST) bends = dy > -EPS && dy < EPS && dx >= -EPS ? 0 : 2;
            else if (dir === WEST) bends = 2;
            else bends = dx >= -EPS && ((dy > -EPS && dy < EPS) || Math.sign(dy) === DJ[dir]) ? 1 : 2;
            return ((dx < 0 ? -dx : dx) + (dy < 0 ? -dy : dy) + bends * bend) * GREED;
        };
        const covered = (count: number, mx: number, my: number): boolean => {
            let ignored = 0;
            for (const o of ignore) {
                if (mx > o.l + EPS && mx < o.r - EPS && my > o.t + EPS && my < o.b - EPS) ignored++;
            }
            return ignored < count;
        };

        const s0 = start * 4 + EAST;
        gArr[s0] = 0;
        parent[s0] = -1;
        stamp[s0] = gen;
        heap.push(h(xs[start % nx], ys[Math.floor(start / nx)], EAST), 0, s0);

        while (heap.size > 0) {
            const state = heap.pop();
            if (closed[state] === gen) continue;
            closed[state] = gen;
            this.expansions++;
            const node = state >> 2;
            const dir = state & 3;
            const cost = gArr[state];

            if (node === goal) {
                if (dir === EAST) return this.trace(state);
                // Turn in place onto the final eastward run into the port.
                if (dir !== WEST) {
                    const t = goal * 4 + EAST;
                    const c = cost + bend;
                    if (closed[t] !== gen && (stamp[t] !== gen || gArr[t] > c)) {
                        stamp[t] = gen;
                        gArr[t] = c;
                        parent[t] = state;
                        heap.push(c, c, t);
                    }
                }
                continue;
            }

            const j = Math.floor(node / nx);
            const i = node - j * nx;
            const x = xs[i];
            const y = ys[j];
            for (let d = 0; d < 4; d++) {
                if (d === OPPOSITE[dir]) continue;
                const ni = i + DI[d];
                const nj = j + DJ[d];
                if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
                const next = nj * nx + ni;
                const ns = next * 4 + d;
                if (closed[ns] === gen) continue;
                let len: number;
                let edgeNet: number;
                let crossNet: number;
                if (d < 2) {
                    const e = j * (nx - 1) + (d === EAST ? i : ni);
                    const count = hBlock[e];
                    if (count !== 0 && (ignore.length === 0 || covered(count, (x + xs[ni]) / 2, y))) continue;
                    len = (d === EAST ? xs[ni] - x : x - xs[ni]) * yw[j];
                    edgeNet = hEdgeNet[e];
                    crossNet = vNodeNet[next];
                } else {
                    const e = (d === SOUTH ? j : nj) * nx + i;
                    const count = vBlock[e];
                    if (count !== 0 && (ignore.length === 0 || covered(count, x, (y + ys[nj]) / 2))) continue;
                    len = (d === SOUTH ? ys[nj] - y : y - ys[nj]) * xw[i];
                    edgeNet = vEdgeNet[e];
                    crossNet = hNodeNet[next];
                }
                let c = cost + len;
                if (edgeNet === srcTag || edgeNet === dstTag) c -= len * (1 - BUNDLE);
                else if (edgeNet !== 0) c += len * costs.share;
                if (crossNet !== 0 && crossNet !== srcTag && crossNet !== dstTag && next !== goal) c += costs.cross;
                if (d !== dir) c += bend;
                if (stamp[ns] === gen && gArr[ns] <= c) continue;
                stamp[ns] = gen;
                gArr[ns] = c;
                parent[ns] = state;
                heap.push(c + h(xs[ni], ys[nj], d), c, ns);
            }
        }
        return null;
    }

    private trace(state: number): number[] {
        const nodes: number[] = [];
        let s = state;
        while (s >= 0) {
            const node = s >> 2;
            if (nodes[nodes.length - 1] !== node) nodes.push(node);
            s = this.parent[s];
        }
        return nodes.reverse();
    }
}
