// ============================================
// PROJECT OMNI: CRYSTALLIZE
//
// Turn an answer into memory. This is the loop the product was built around:
// data → insight → memory → context for the next question.
//
// The rule that shapes the whole design: crystallizing must produce something
// the user can SEE. Writing an insight into a Mind pool with no Memory block
// on the canvas would repeat exactly the mistake that made ambient context
// wrong — real context with no spatial representation. So this finds a Memory
// block for the pool, and creates one if there is none.
// ============================================

import { useBlockStore } from '@/core/stores/blockStore';
import { useMindStore } from '@/core/stores/mindStore';
import { useWireStore } from '@/core/stores/wireStore';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { createMemoryBlockData, type MemoryBlockData } from '@/core/schemas/mind.schema';

export const CRYSTAL_POOL = 'memory';

interface CrystallizeResult {
    ok: boolean;
    /** The Memory block the insight is now visible in. */
    memoryBlockId?: string;
    /** True when a Memory block had to be created to hold it. */
    createdBlock: boolean;
    /** True when a wire was drawn back to the persona that produced it. */
    wiredBack: boolean;
    error?: string;
}

/** An existing Memory block on this shell pointed at the given pool. */
function findMemoryBlock(shellId: string, poolId: string): string | undefined {
    return useBlockStore
        .getState()
        .blocks.find(
            b =>
                b.shellId === shellId &&
                b.schema.block_id === 'memory_pool' &&
                (b.data as MemoryBlockData | undefined)?.poolId === poolId
        )?.instance_id;
}

/**
 * Crystallize one answer into memory.
 *
 * `sourceBlockId` is the persona that produced it — used to place the new
 * block near it, and to wire memory back in so the persona can recall what it
 * previously concluded.
 */
export function crystallize(content: string, sourceBlockId: string): CrystallizeResult {
    const text = content.trim();
    if (!text) return { ok: false, createdBlock: false, wiredBack: false, error: 'Nothing to crystallize.' };

    const blockStore = useBlockStore.getState();
    const persona = blockStore.getBlock(sourceBlockId);
    const shellId = persona?.shellId || blockStore.activeShellId;

    let memoryBlockId = findMemoryBlock(shellId, CRYSTAL_POOL);
    let createdBlock = false;

    if (!memoryBlockId) {
        const schema = blockRegistry.get('memory_pool');
        if (!schema) {
            return {
                ok: false,
                createdBlock: false,
                wiredBack: false,
                error: 'Memory block is not registered.'
            };
        }
        // Place it beside the persona rather than at the origin, so the block
        // appears where the user is already looking.
        const at = persona
            ? { x: persona.position.x + persona.dimensions.width + 40, y: persona.position.y }
            : { x: 120, y: 120 };

        memoryBlockId = blockStore.addBlock(schema, at, shellId);
        blockStore.updateData(memoryBlockId, createMemoryBlockData(CRYSTAL_POOL));
        createdBlock = true;
    }

    useMindStore.getState().pushContext(CRYSTAL_POOL, {
        type: 'memory',
        content: text,
        importance: 0.8,
        sourceBlockId
    });

    // Wire memory back into the persona that produced it: an insight worth
    // keeping is an insight worth recalling next time. Only on creation —
    // re-wiring an existing block every time would fight the user's own layout.
    let wiredBack = false;
    if (createdBlock && persona) {
        useWireStore.getState().addWire(memoryBlockId, sourceBlockId, undefined, shellId);
        wiredBack = true;
    }

    return { ok: true, memoryBlockId, createdBlock, wiredBack };
}
