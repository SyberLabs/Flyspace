// What the Mind answers in the public preview: why it cannot think right now.
// A shell with nothing wired or pinned gets the more useful refusal, unless the
// person asked a question.

import { useBlockStore, useMindStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { PREVIEW_AI_OFF_MESSAGE } from './personaTurn.service';

const NO_SCOPE_ERROR =
    'Nothing to think about: no wired or pinned blocks in this shell. Wire a block to another block, or pin one, first.';

function hasBlocksInScope(): boolean {
    const blockStore = useBlockStore.getState();
    const { isPinned } = useMindStore.getState();
    const shellBlocks = blockStore.getBlocksByShell(blockStore.activeShellId);
    const ids = new Set(shellBlocks.map(block => block.instance_id));
    const wired = useWireStore.getState().wires.some(wire => ids.has(wire.sourceBlockId) && ids.has(wire.targetBlockId));
    return wired || shellBlocks.some(block => isPinned(block.instance_id));
}

/** The message to show, leaving the Mind's status as the attempt left it. */
export function thinkInPreview(question?: string): string {
    const mind = useMindStore.getState();
    if (!mind.personas.some(persona => persona.id === mind.activePersonaId)) {
        mind.setStatus('error');
        return 'No active persona';
    }
    if (!hasBlocksInScope() && !question?.trim()) {
        mind.setStatus('ready');
        return NO_SCOPE_ERROR;
    }
    mind.setStatus('error');
    return PREVIEW_AI_OFF_MESSAGE;
}
