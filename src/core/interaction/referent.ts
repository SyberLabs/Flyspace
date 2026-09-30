// Deictic resolution is deterministic and shell-scoped.
// Two close candidates hold. The resolver does not guess.

import type { CanvasBlockView, FramedPoint } from './types';

export interface ResolveInput {
    shellId: string;
    blocks: CanvasBlockView[];
    point?: FramedPoint;
    selection: string[];
    recentInteraction: string[];
    recentDiscourse: string[];
    noun?: string;
    /** "these" may resolve to an explicit multi-selection. */
    allowSet?: boolean;
}

export type ResolveResult =
    | { status: 'resolved'; ids: string[] }
    | { status: 'hold'; candidates: string[]; reason: 'ambiguous' | 'none' };

function inShell(blocks: CanvasBlockView[], shellId: string): CanvasBlockView[] {
    return blocks.filter(block => block.shellId === shellId);
}

function containsPoint(block: CanvasBlockView, point: FramedPoint): boolean {
    return (
        point.x >= block.x &&
        point.x <= block.x + block.width &&
        point.y >= block.y &&
        point.y <= block.y + block.height
    );
}

function nounMatches(block: CanvasBlockView, noun: string): boolean {
    const needle = noun.toLowerCase();
    return (
        block.name.toLowerCase().includes(needle) ||
        block.blockId.toLowerCase().includes(needle) ||
        block.tags.some(tag => tag.toLowerCase().includes(needle))
    );
}

function finish(ids: string[], allowSet: boolean): ResolveResult {
    if (ids.length === 1) return { status: 'resolved', ids };
    if (allowSet && ids.length > 1) return { status: 'resolved', ids };
    if (ids.length > 1) return { status: 'hold', candidates: ids, reason: 'ambiguous' };
    return { status: 'hold', candidates: [], reason: 'none' };
}

export function resolveReferents(input: ResolveInput): ResolveResult {
    const shell = inShell(input.blocks, input.shellId);
    const noun = input.noun?.trim();

    if (input.point && input.point.frame === 'canvas') {
        let hit = shell.filter(block => containsPoint(block, input.point!));
        if (noun) hit = hit.filter(block => nounMatches(block, noun));
        if (hit.length > 0) return finish(hit.map(block => block.id), false);
    }

    if (input.selection.length > 0) {
        const selected = input.selection.filter(id => shell.some(block => block.id === id));
        if (selected.length > 0) return finish(selected, input.allowSet === true);
    }

    if (noun) {
        const named = shell.filter(block => nounMatches(block, noun));
        if (named.length > 0) return finish(named.map(block => block.id), input.allowSet === true);
    }

    const recent = [...input.recentInteraction, ...input.recentDiscourse].filter(id =>
        shell.some(block => block.id === id)
    );
    if (recent.length === 1) return { status: 'resolved', ids: recent };
    if (recent.length > 1) return { status: 'hold', candidates: [...new Set(recent)], reason: 'ambiguous' };

    return { status: 'hold', candidates: [], reason: 'none' };
}
