import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { findFreeSpot, PLACEMENT_GAP, PLACEMENT_MARGIN, type PlacementRect } from './placement';
import { useBlockStore } from './blockStore';
import type { OmniBlockSchema } from '../schemas/block.schema';

const SIZE = { width: 320, height: 240 };

function clear(a: PlacementRect, b: PlacementRect, gap: { x: number; y: number }): boolean {
    return a.x + a.width + gap.x <= b.x || b.x + b.width + gap.x <= a.x
        || a.y + a.height + gap.y <= b.y || b.y + b.height + gap.y <= a.y;
}

describe('findFreeSpot', () => {
    it('keeps the requested point when it is free', () => {
        expect(findFreeSpot([], { x: 300, y: 200 }, SIZE)).toEqual({ x: 300, y: 200 });
        const far = [{ x: 1200, y: 1200, ...SIZE }];
        expect(findFreeSpot(far, { x: 100, y: 100 }, SIZE)).toEqual({ x: 100, y: 100 });
    });

    it('moves a block off another one to the nearest free spot, beside it', () => {
        const persona = { x: 800, y: 120, width: 320, height: 400 };
        const spot = findFreeSpot([persona], { x: 820, y: 140 }, SIZE);
        expect(clear({ ...spot, ...SIZE }, persona, PLACEMENT_GAP)).toBe(true);
        // Snug against the persona: no further than one block plus the gap from where it was asked.
        expect(Math.hypot(spot.x - 820, spot.y - 140)).toBeLessThanOrEqual(SIZE.width + PLACEMENT_GAP.x);
    });

    it('never lands on any block in a crowded canvas (property)', () => {
        let seed = 9;
        const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
        for (let round = 0; round < 40; round++) {
            const occupied: PlacementRect[] = [];
            for (let i = 0; i < 12; i++) {
                const desired = { x: Math.round(r() * 1200), y: Math.round(r() * 800) };
                const spot = findFreeSpot(occupied, desired, SIZE);
                for (const o of occupied) expect(clear({ ...spot, ...SIZE }, o, PLACEMENT_GAP)).toBe(true);
                expect(spot.x).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);
                expect(spot.y).toBeGreaterThanOrEqual(PLACEMENT_MARGIN);
                occupied.push({ ...spot, ...SIZE });
            }
        }
    });

    it('is deterministic', () => {
        const occupied = [{ x: 40, y: 40, ...SIZE }, { x: 420, y: 40, ...SIZE }, { x: 40, y: 320, ...SIZE }];
        const a = findFreeSpot(occupied, { x: 100, y: 100 }, SIZE);
        expect(findFreeSpot(occupied, { x: 100, y: 100 }, SIZE)).toEqual(a);
        expect(findFreeSpot([...occupied].reverse(), { x: 100, y: 100 }, SIZE)).toEqual(a);
    });
});

describe('blockStore.addBlock placement', () => {
    const schema: OmniBlockSchema = { block_id: 'text_note', display_name: 'Note', category: 'truth', semantic_tags: [] };

    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('does not put a new block on top of an existing one', () => {
        const first = useBlockStore.getState().addBlock(schema, { x: 320, y: 80 }, 'root');
        const second = useBlockStore.getState().addBlock(schema, { x: 330, y: 90 }, 'root');
        const a = useBlockStore.getState().getBlock(first)!;
        const b = useBlockStore.getState().getBlock(second)!;
        expect(a.position).toEqual({ x: 320, y: 80 });
        expect(clear({ ...a.position, ...a.dimensions }, { ...b.position, ...b.dimensions }, PLACEMENT_GAP)).toBe(true);
    });

    it('only avoids blocks on the same shell', () => {
        useBlockStore.getState().addBlock(schema, { x: 320, y: 80 }, 'other');
        const id = useBlockStore.getState().addBlock(schema, { x: 320, y: 80 }, 'root');
        expect(useBlockStore.getState().getBlock(id)!.position).toEqual({ x: 320, y: 80 });
    });
});
