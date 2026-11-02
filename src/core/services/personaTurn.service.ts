// A persona turn in the public preview. There is no model to ask, so a turn
// commits the question (if any) and says why no answer came, in the conversation.

import { useBlockStore } from '@/core/stores/blockStore';
import { newId } from '@/core/id';
import type { PersonaBlockData, PersonaChatMessage } from '@/core/schemas/wire.schema';

export const PREVIEW_AI_OFF_MESSAGE = 'AI answers are off in the public preview. Live data and wires still work.';

/** Run one persona's turn: its answer is always the preview's refusal. */
export function runPersonaTurn(instanceId: string, userMessage?: string): void {
    const store = useBlockStore.getState();
    const current = store.getBlock(instanceId)?.data as PersonaBlockData | undefined;
    if (!current) return;
    const now = Date.now();
    const messages: PersonaChatMessage[] = [
        ...current.messages,
        ...(userMessage ? [{ id: `msg-${newId()}`, role: 'user' as const, content: userMessage, timestamp: now }] : []),
        { id: `msg-${newId()}`, role: 'assistant' as const, content: `⚠️ ${PREVIEW_AI_OFF_MESSAGE}`, timestamp: now, sourcedFrom: [], sources: [] }
    ];
    store.updateData(instanceId, { ...current, messages, isThinking: false, lastContextUpdate: now });
}

/** Drop the last answer and give the same turn another go. */
export function regeneratePersonaTurn(instanceId: string): void {
    const store = useBlockStore.getState();
    const current = store.getBlock(instanceId)?.data as PersonaBlockData | undefined;
    if (!current) return;
    const lastIndex = current.messages.findLastIndex(message => message.role === 'assistant');
    if (lastIndex < 0) return;
    store.updateData(instanceId, { ...current, messages: current.messages.slice(0, lastIndex) });
    runPersonaTurn(instanceId);
}
