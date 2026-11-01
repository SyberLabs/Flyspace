// ============================================
// PROJECT OMNI: CASCADE
//
// "Plural minds" — Analyst feeds Strategist. Wiring persona to persona has
// always been possible; until the source formatter was fixed it delivered
// noise, and even then nothing triggered the upstream turn, so a downstream
// persona reasoned over whatever its neighbour last happened to say.
//
// This resolves the run order: every persona upstream of the target, in
// dependency order, then the target itself. It only computes the plan —
// running a turn belongs to the block that owns the conversation.
// ============================================

import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';

function isPersona(blockId: string): boolean {
    const block = useBlockStore.getState().getBlock(blockId);
    return !!block && block.schema.block_id.startsWith('persona_');
}

/** Persona blocks feeding this one directly. */
function personaSourcesOf(blockId: string): string[] {
    return useWireStore
        .getState()
        .getWiresToBlock(blockId)
        .map(w => w.sourceBlockId)
        .filter(isPersona);
}

interface CascadePlan {
    /** Personas to run, upstream first; the target is last. */
    order: string[];
    /** True when a cycle was found and broken to keep the plan finite. */
    hadCycle: boolean;
}

/**
 * Resolve the run order for a target persona: a depth-first walk up the
 * persona wires, emitting each block after its own sources.
 *
 * Cycles are possible — nothing stops a user wiring two personas to each
 * other — so a block already being visited is skipped rather than followed.
 * The plan stays finite and each persona runs at most once.
 */
export function planCascade(targetBlockId: string): CascadePlan {
    const order: string[] = [];
    const done = new Set<string>();
    const onPath = new Set<string>();
    let hadCycle = false;

    const visit = (id: string) => {
        if (done.has(id)) return;
        if (onPath.has(id)) {
            hadCycle = true;
            return;
        }
        onPath.add(id);
        for (const source of personaSourcesOf(id)) visit(source);
        onPath.delete(id);
        done.add(id);
        order.push(id);
    };

    visit(targetBlockId);
    return { order, hadCycle };
}

/** Whether a target has any upstream personas — i.e. whether a chain exists. */
export function hasUpstreamPersonas(targetBlockId: string): boolean {
    return personaSourcesOf(targetBlockId).length > 0;
}
