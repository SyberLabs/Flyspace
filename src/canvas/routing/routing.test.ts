import { describe, it, expect } from 'vitest';
import { routeWires, WireRouter, segmentHits, splitPoint, polylineToPath, DEFAULT_ROUTE_OPTIONS } from './index';
import type { Point, RouteBlock, RouteWire, RoutedWire } from './types';

const EPS = 1e-6;

/** Small deterministic PRNG so property tests are reproducible. */
function rng(seed: number): () => number {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function rectOf(b: RouteBlock) {
    return { l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height };
}

/** Random non-overlapping layout: blocks on a jittered grid, random wires. */
function layout(seed: number, nBlocks: number, nWires: number, cols = 6) {
    const r = rng(seed);
    const blocks: RouteBlock[] = [];
    for (let i = 0; i < nBlocks; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        blocks.push({
            id: `b${i}`,
            x: 40 + col * 400 + Math.round(r() * 40),
            y: 40 + row * 340 + Math.round(r() * 30),
            width: 320,
            height: r() < 0.3 ? 280 : 240
        });
    }
    const wires: RouteWire[] = [];
    for (let i = 0; i < nWires; i++) {
        const s = Math.floor(r() * nBlocks);
        let t = Math.floor(r() * nBlocks);
        if (t === s) t = (t + 1) % nBlocks;
        wires.push({ id: `w${i}`, source: `b${s}`, target: `b${t}` });
    }
    return { blocks, wires };
}

/** The screenshot case: seven data blocks into one Analyst, blocks in between. */
function fanIn() {
    const blocks: RouteBlock[] = [
        { id: 'weather', x: 40, y: 40, width: 320, height: 240 },
        { id: 'quakes', x: 40, y: 320, width: 320, height: 240 },
        { id: 'wiki', x: 420, y: 40, width: 320, height: 240 },
        { id: 'fx', x: 420, y: 320, width: 320, height: 240 },
        { id: 'github', x: 800, y: 40, width: 320, height: 240 },
        { id: 'analyst', x: 800, y: 360, width: 320, height: 400 },
        { id: 'poly', x: 40, y: 600, width: 320, height: 240 },
        { id: 'hn', x: 420, y: 600, width: 320, height: 240 }
    ];
    const wires: RouteWire[] = ['weather', 'quakes', 'wiki', 'fx', 'github', 'poly', 'hn']
        .map(s => ({ id: `w-${s}`, source: s, target: 'analyst' }));
    return { blocks, wires };
}

function segments(p: Point[]): Array<[Point, Point]> {
    const out: Array<[Point, Point]> = [];
    for (let k = 0; k + 1 < p.length; k++) out.push([p[k], p[k + 1]]);
    return out;
}

function expectOrthogonal(w: RoutedWire) {
    for (const [a, b] of segments(w.points)) {
        expect(Math.abs(a.x - b.x) < EPS || Math.abs(a.y - b.y) < EPS).toBe(true);
    }
}

function blockHits(blocks: RouteBlock[], w: RoutedWire): string[] {
    const hits: string[] = [];
    for (const b of blocks) {
        for (const [a, c] of segments(w.points)) {
            if (segmentHits(rectOf(b), a, c)) {
                hits.push(b.id);
                break;
            }
        }
    }
    return hits;
}

describe('routeWires: circuit-style routing', () => {
    it('leaves the output port and enters the input port horizontally, heading east', () => {
        const blocks: RouteBlock[] = [
            { id: 'a', x: 0, y: 0, width: 200, height: 100 },
            { id: 'b', x: 400, y: 300, width: 200, height: 100 }
        ];
        const [w] = routeWires(blocks, [{ id: 'w', source: 'a', target: 'b' }]).wires;
        const p = w.points;
        const o = DEFAULT_ROUTE_OPTIONS;
        expect(p[0]).toEqual({ x: 200 + o.portOutset, y: 50 });
        expect(p[p.length - 1]).toEqual({ x: 400 - o.portOutset, y: 350 });
        // First run goes east from the port, last run arrives going east.
        expect(p[1].y).toBeCloseTo(p[0].y);
        expect(p[1].x).toBeGreaterThan(p[0].x);
        expect(p[p.length - 2].y).toBeCloseTo(p[p.length - 1].y);
        expect(p[p.length - 2].x).toBeLessThan(p[p.length - 1].x);
        expectOrthogonal(w);
        expect(w.routed).toBe(true);
    });

    it('goes around a block standing between source and target', () => {
        const blocks: RouteBlock[] = [
            { id: 'a', x: 0, y: 100, width: 200, height: 100 },
            { id: 'wall', x: 320, y: 0, width: 200, height: 300 },
            { id: 'b', x: 640, y: 100, width: 200, height: 100 }
        ];
        const [w] = routeWires(blocks, [{ id: 'w', source: 'a', target: 'b' }]).wires;
        expect(blockHits(blocks, w)).toEqual([]);
        // It keeps the clearance from the wall, not just the wall itself.
        const wall = blocks[1];
        const c = DEFAULT_ROUTE_OPTIONS.clearance;
        const inflated = { l: wall.x - c + 1, t: wall.y - c + 1, r: wall.x + wall.width + c - 1, b: wall.y + wall.height + c - 1 };
        expect(segments(w.points).some(([a, b]) => segmentHits(inflated, a, b))).toBe(false);
    });

    it('routes a backward wire (target left of source) around both blocks', () => {
        const blocks: RouteBlock[] = [
            { id: 'a', x: 500, y: 0, width: 200, height: 100 },
            { id: 'b', x: 0, y: 40, width: 200, height: 100 }
        ];
        const [w] = routeWires(blocks, [{ id: 'w', source: 'a', target: 'b' }]).wires;
        expect(w.routed).toBe(true);
        expect(blockHits(blocks, w)).toEqual([]);
        expectOrthogonal(w);
    });

    it('never runs a wire through any block on random layouts (property)', () => {
        for (let seed = 1; seed <= 120; seed++) {
            const { blocks, wires } = layout(seed, 12 + (seed % 10), 18 + (seed % 15), 4 + (seed % 3));
            const res = routeWires(blocks, wires);
            expect(res.wires).toHaveLength(wires.length);
            for (const w of res.wires) {
                expect(w.routed, `seed ${seed} wire ${w.id} found no path`).toBe(true);
                expectOrthogonal(w);
                // Not through any block, including the wire's own source and target.
                expect(blockHits(blocks, w), `seed ${seed} wire ${w.id}`).toEqual([]);
            }
        }
    });

    it('is deterministic: the same layout gives the same wires, whatever the input order', () => {
        const { blocks, wires } = layout(7, 20, 30);
        const a = routeWires(blocks, wires);
        const b = routeWires(blocks, wires);
        expect(b.wires).toEqual(a.wires);
        expect(b.junctions).toEqual(a.junctions);

        const shuffled = routeWires([...blocks].reverse(), [...wires].reverse());
        const byId = new Map(shuffled.wires.map(w => [w.id, w]));
        for (const w of a.wires) expect(byId.get(w.id)).toEqual(w);
    });

    it('spreads parallel runs of different outputs into lanes that never overlap', () => {
        let nearPort = 0;
        const check = (blocks: RouteBlock[], wires: RouteWire[], label: string) => {
            const res = routeWires(blocks, wires);
            type Seg = { w: RoutedWire; a: Point; b: Point };
            // A port jog (the short step a moved lane takes onto its port row,
            // within `mergeJog` of the port) is where lanes merge; it is the one
            // place a lane may touch another wire. Everything else must not.
            const jog = (w: RoutedWire, k: number) => {
                const p = w.points;
                const reach = DEFAULT_ROUTE_OPTIONS.mergeJog + 0.5;
                return (k === 1 && Math.abs(p[1].x - p[0].x) <= reach)
                    || (k === p.length - 3 && Math.abs(p[p.length - 1].x - p[p.length - 2].x) <= reach);
            };
            const ports = res.wires.flatMap(w => [w.points[0], w.points[w.points.length - 1]]);
            const all: Seg[] = res.wires.flatMap(w => segments(w.points)
                .map(([a, b], k) => ({ w, a, b, k }))
                .filter(s => !jog(s.w, s.k)));
            for (let i = 0; i < all.length; i++) {
                for (let j = i + 1; j < all.length; j++) {
                    const s = all[i];
                    const t = all[j];
                    // Wires of one output may share a run (a bundle); wires into one input may share their trunk.
                    if (s.w.source === t.w.source || s.w.target === t.w.target) continue;
                    const sh = Math.abs(s.a.y - s.b.y) < EPS;
                    const th = Math.abs(t.a.y - t.b.y) < EPS;
                    if (sh !== th) continue;
                    const across = sh ? Math.abs(s.a.y - t.a.y) : Math.abs(s.a.x - t.a.x);
                    if (across > EPS) continue;
                    const lo = sh ? Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x)) : Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
                    const hi = sh ? Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) : Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y));
                    if (hi - lo <= 0.5) continue;
                    // Known limit: in the few pixels in front of a port (within
                    // stub + mergeJog of it), e.g. two ports facing each other across
                    // a narrow gap, a jog can touch another wire.
                    const ends = sh ? [{ x: lo, y: s.a.y }, { x: hi, y: s.a.y }] : [{ x: s.a.x, y: lo }, { x: s.a.x, y: hi }];
                    const reach = DEFAULT_ROUTE_OPTIONS.stub + DEFAULT_ROUTE_OPTIONS.mergeJog;
                    const inZone = (q: Point) => ports.some(p => Math.abs(p.x - q.x) <= reach && Math.abs(p.y - q.y) <= reach);
                    if (ends.every(inZone)) {
                        nearPort++;
                        continue;
                    }
                    expect(hi - lo, `${label}: ${s.w.id} and ${t.w.id} share a lane`).toBeLessThanOrEqual(0.5);
                }
            }
        };
        const f = fanIn();
        check(f.blocks, f.wires, 'fan-in');
        for (const seed of Array.from({ length: 80 }, (_, i) => i + 1)) {
            const { blocks, wires } = layout(seed, 16, 24, 4);
            check(blocks, wires, `seed ${seed}`);
        }
        // Measured: 19 such touches across these 80 layouts (1,920 wires). Guard against growth.
        expect(nearPort).toBeLessThanOrEqual(24);
    });

    it('fans seven sources into one input along one trunk, with junction dots', () => {
        const { blocks, wires } = fanIn();
        const res = routeWires(blocks, wires);
        for (const w of res.wires) expect(blockHits(blocks, w)).toEqual([]);
        // Every wire reaches the port on the same final run: the trunk.
        const lastVertical = res.wires.map(w => w.points[w.points.length - 3]?.x);
        expect(new Set(lastVertical).size).toBe(1);
        expect(res.junctions.length).toBeGreaterThan(0);
        for (const j of res.junctions) expect(j.wires).toHaveLength(2);
    });

    it('marks a hop where one wire must cross another', () => {
        // a -> d runs east along y=150; c sits below and feeds b above, so its riser crosses.
        const blocks: RouteBlock[] = [
            { id: 'a', x: 0, y: 100, width: 100, height: 100 },
            { id: 'd', x: 700, y: 100, width: 100, height: 100 },
            { id: 'c', x: 200, y: 400, width: 100, height: 100 },
            { id: 'b', x: 450, y: -300, width: 100, height: 100 }
        ];
        const res = routeWires(blocks, [
            { id: 'h', source: 'a', target: 'd' },
            { id: 'v', source: 'c', target: 'b' }
        ]);
        const hops = res.wires.flatMap(w => w.hops);
        expect(hops.length).toBeGreaterThan(0);
        const path = polylineToPath(res.wires.find(w => w.hops.length)!.points, hops);
        expect(path).toContain(' A ');
    });

    it('lets a wire out when its port is walled in by an overlapping block, without crashing', () => {
        const blocks: RouteBlock[] = [
            { id: 'a', x: 0, y: 0, width: 200, height: 100 },
            { id: 'over', x: 150, y: -20, width: 200, height: 140 },
            { id: 'b', x: 600, y: 0, width: 200, height: 100 }
        ];
        const [w] = routeWires(blocks, [{ id: 'w', source: 'a', target: 'b' }]).wires;
        expectOrthogonal(w);
        expect(w.points[0].x).toBeCloseTo(216);
    });

    it('gets a port out of a neighbour too close to it without crossing that neighbour', () => {
        // n stands 20px right of a's edge: a's port is inside n's clearance margin, not under n.
        const blocks: RouteBlock[] = [
            { id: 'a', x: 0, y: 100, width: 200, height: 100 },
            { id: 'n', x: 220, y: 0, width: 200, height: 400 },
            { id: 'b', x: 700, y: 100, width: 200, height: 100 }
        ];
        const [w] = routeWires(blocks, [{ id: 'w', source: 'a', target: 'b' }]).wires;
        expect(blockHits(blocks, w)).toEqual([]);
        expectOrthogonal(w);
    });

    it('skips wires whose blocks are missing', () => {
        const res = routeWires([{ id: 'a', x: 0, y: 0, width: 10, height: 10 }], [{ id: 'w', source: 'a', target: 'gone' }]);
        expect(res.wires).toEqual([]);
    });
});

describe('WireRouter: live drag', () => {
    it('re-routes wires the moving block runs into, and never draws through it', () => {
        const base = fanIn();
        // Open a corridor in front of the Analyst, then drag GitHub down through it.
        const blocks = base.blocks.map(b => (b.id === 'analyst' ? { ...b, x: 1240 } : b));
        const wires = base.wires;
        const router = new WireRouter();
        router.route(blocks, wires);
        for (let step = 1; step <= 14; step++) {
            const moved = blocks.map(b => (b.id === 'github' ? { ...b, x: 820, y: b.y + step * 40 } : b));
            const res = router.routeLive(moved, wires, 'github');
            const gh = moved.find(b => b.id === 'github')!;
            for (const w of res.wires) {
                if (w.source === 'github' || w.target === 'github') continue;
                expect(blockHits([gh], w), `step ${step} ${w.id}`).toEqual([]);
            }
        }
    });

    it('settles to exactly the full route on drop', () => {
        const { blocks, wires } = fanIn();
        const router = new WireRouter();
        router.route(blocks, wires);
        const moved = blocks.map(b => (b.id === 'hn' ? { ...b, y: b.y + 80 } : b));
        router.routeLive(moved, wires, 'hn');
        expect(router.route(moved, wires).wires).toEqual(routeWires(moved, wires).wires);
    });
});

describe('routing performance budget', () => {
    // Measured 2026-10-08 on the dev machine (Node 22 via tsx, Windows 11,
    // median of 30-60 runs): 51 ms for a full route of 30 blocks / 60 random
    // wires, 14 ms per live drag frame of that layout, 0.5 ms for a 9-block
    // fan-in like the screenshot. The budgets below are loose
    // so CI noise does not flake them; they catch a regression of an order of
    // magnitude, not a few milliseconds.
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

    it('routes the screenshot fan-in layout well inside one frame', () => {
        const { blocks, wires } = fanIn();
        routeWires(blocks, wires);
        const times: number[] = [];
        for (let i = 0; i < 20; i++) {
            const t0 = performance.now();
            routeWires(blocks, wires);
            times.push(performance.now() - t0);
        }
        expect(median(times)).toBeLessThan(8);
    });

    it('routes 30 blocks / 60 wires within budget, and a live drag frame faster', () => {
        const { blocks, wires } = layout(42, 30, 60);
        routeWires(blocks, wires);
        const full: number[] = [];
        for (let i = 0; i < 5; i++) {
            const t0 = performance.now();
            routeWires(blocks, wires);
            full.push(performance.now() - t0);
        }
        const router = new WireRouter();
        router.route(blocks, wires);
        const live: number[] = [];
        for (let k = 0; k < 10; k++) {
            const moved = blocks.map(b => (b.id === 'b14' ? { ...b, x: b.x + k * 9, y: b.y + k * 4 } : b));
            const t0 = performance.now();
            router.routeLive(moved, wires, 'b14');
            live.push(performance.now() - t0);
        }
        expect(median(full)).toBeLessThan(250);
        expect(median(live)).toBeLessThan(median(full));
    });
});

describe('splitPoint', () => {
    it('finds where two polylines from one port part ways', () => {
        const a = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }];
        const b = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: -40 }];
        expect(splitPoint(a, b)).toEqual({ x: 50, y: 0 });
        expect(splitPoint(a, a)).toBeNull();
    });
});
