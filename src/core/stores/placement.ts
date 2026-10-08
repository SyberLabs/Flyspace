// Where a new block goes: the requested point if that space is free, else the
// nearest free spot. Pure; used by blockStore.addBlock so every way of adding
// a block (Armory drop or click, Add an API, command palette, speech) gets it.

export interface PlacementRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Space kept between blocks. Ports sit on the left and right sides, so a
 * side-by-side pair needs room for both port handles, both stubs and a lane
 * or two between them; above and below, a wire's clearance on both sides and
 * a couple of lanes are enough.
 */
export const PLACEMENT_GAP = { x: 72, y: 40 };

/** Smallest x and y a placed block may have: room for its input port handle at the canvas edge. */
export const PLACEMENT_MARGIN = 24;

function overlaps(a: PlacementRect, b: PlacementRect, gap: { x: number; y: number }): boolean {
    return a.x < b.x + b.width + gap.x
        && a.x + a.width + gap.x > b.x
        && a.y < b.y + b.height + gap.y
        && a.y + a.height + gap.y > b.y;
}

/**
 * The free top-left nearest to `desired` for a block of `size`, keeping `gap`
 * (horizontal and vertical)
 * from every occupied rect and staying at x, y >= PLACEMENT_MARGIN. Candidates are the
 * requested point and the positions snug against each existing block (left,
 * right, above, below, and their combinations), so a block lands beside its
 * neighbours rather than at some arbitrary offset. Deterministic: ties go to
 * the smaller y, then the smaller x.
 */
export function findFreeSpot(
    occupied: PlacementRect[],
    desired: { x: number; y: number },
    size: { width: number; height: number },
    gap: { x: number; y: number } = PLACEMENT_GAP
): { x: number; y: number } {
    const want = { x: Math.max(PLACEMENT_MARGIN, desired.x), y: Math.max(PLACEMENT_MARGIN, desired.y) };
    const fits = (x: number, y: number) => {
        const r = { x, y, width: size.width, height: size.height };
        return occupied.every(o => !overlaps(r, o, gap));
    };
    if (fits(want.x, want.y)) return want;

    const xs = new Set<number>([want.x]);
    const ys = new Set<number>([want.y]);
    for (const o of occupied) {
        xs.add(o.x + o.width + gap.x);
        xs.add(o.x - gap.x - size.width);
        xs.add(o.x);
        ys.add(o.y + o.height + gap.y);
        ys.add(o.y - gap.y - size.height);
        ys.add(o.y);
    }
    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    for (const x of xs) {
        if (x < PLACEMENT_MARGIN) continue;
        for (const y of ys) {
            if (y < PLACEMENT_MARGIN) continue;
            const score = (x - want.x) ** 2 + (y - want.y) ** 2;
            if (score > bestScore) continue;
            if (score === bestScore && best && (y > best.y || (y === best.y && x >= best.x))) continue;
            if (!fits(x, y)) continue;
            best = { x, y };
            bestScore = score;
        }
    }
    if (best) return best;
    // Unreachable in practice (right of everything is always free); keep a total answer.
    const right = Math.max(PLACEMENT_MARGIN, ...occupied.map(o => o.x + o.width + gap.x));
    return { x: right, y: want.y };
}
