// ============================================
// PROJECT OMNI: PERSONA TURN (block-level)
//
// Running a turn used to live inside the PersonaBlock component, which meant
// only the component rendering a persona could make it think. That is fine
// until one persona needs to run another — the cascade — so the turn moved
// here, where it is addressed by block id and needs no React at all.
//
// Layering: persona.engine assembles the prompt and streams it (pure); this
// owns the block-store side effects — draft messages, thinking state,
// provenance, throttled commits, abort, regenerate.
// ============================================

import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import { useUIStore } from '@/core/stores/uiStore';
import { streamPersonaTurn } from './persona.engine';
import { newId } from '@/core/id';
import type { PersonaBlockData, ContextSource, PersonaChatMessage } from '@/core/schemas/wire.schema';

/**
 * How often a streaming answer is published to the store. Fast enough to read
 * as live typing, slow enough that the canvas is not re-rendered per token.
 */
export const STREAM_COMMIT_MS = 80;

export interface PersonaTurnOutcome {
    ran: boolean;
    success: boolean;
    error?: string;
    /** User halted the stream. The partial answer was kept. */
    stopped?: boolean;
}

const inflight = new Map<string, AbortController>();

/** Halt the in-flight turn for this block. Cascade checks the outcome. */
export function stopPersonaTurn(instanceId: string): boolean {
    const controller = inflight.get(instanceId);
    if (!controller) return false;
    controller.abort();
    return true;
}

/**
 * Re-run the last assistant turn with the same input. The previous answer
 * is dropped so the new stream replaces it rather than stacking.
 */
export async function regeneratePersonaTurn(instanceId: string): Promise<PersonaTurnOutcome> {
    const store = useBlockStore.getState();
    const current = store.getBlock(instanceId)?.data as PersonaBlockData | undefined;
    if (!current) return { ran: false, success: false, error: 'Persona block not found.' };
    if (current.isThinking) return { ran: false, success: false, error: 'Already thinking.' };

    const lastAssistant = [...current.messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return { ran: false, success: false, error: 'Nothing to regenerate.' };

    const lastIndex = current.messages.findLastIndex(m => m.id === lastAssistant.id);
    const withoutAssistant = current.messages.slice(0, lastIndex);
    const prior = withoutAssistant.at(-1);

    store.updateData(instanceId, { ...current, messages: withoutAssistant });

    if (prior?.role === 'user') {
        return runPersonaTurn(instanceId, prior.content, { userAlreadyInHistory: true });
    }
    return runPersonaTurn(instanceId);
}

/**
 * Run one persona's turn and stream it into its block.
 *
 * Never throws: a failure is committed into the conversation as a visible
 * warning, because a persona that silently does nothing is worse than one
 * that says why. A user Stop keeps the partial and marks it stopped.
 */
export async function runPersonaTurn(
    instanceId: string,
    userMessage?: string,
    options?: { userAlreadyInHistory?: boolean }
): Promise<PersonaTurnOutcome> {
    const store = useBlockStore.getState();
    const block = store.getBlock(instanceId);
    const current = block?.data as PersonaBlockData | undefined;

    if (!current) return { ran: false, success: false, error: 'Persona block not found.' };
    if (current.isThinking) return { ran: false, success: false, error: 'Already thinking.' };

    const appendingUser = Boolean(userMessage) && !options?.userAlreadyInHistory;
    const baseMessages: PersonaChatMessage[] = appendingUser
        ? [
            ...current.messages,
            {
                id: `msg-${newId()}`,
                role: 'user' as const,
                content: userMessage!,
                timestamp: Date.now()
            }
        ]
        : current.messages;

    const historyForEngine = options?.userAlreadyInHistory && userMessage
        ? baseMessages.slice(0, -1)
        : current.messages;

    store.updateData(instanceId, { ...current, messages: baseMessages, isThinking: true });

    const assistantId = `msg-${newId()}`;
    let acc = '';
    let turnSources: ContextSource[] = [];
    // Ledger row id for this turn. Stored on the committed answer so that when
    // a downstream persona consumes it, the cascade edge names the run rather
    // than just the block — see INFERENCE_LEDGER.md, "Lineage".
    let turnRunId: string | undefined;

    const commit = (content: string, isThinking: boolean, extra?: { stopped?: boolean }) => {
        const latest =
            (useBlockStore.getState().getBlock(instanceId)?.data as PersonaBlockData) || current;
        const withoutDraft = latest.messages.filter(m => m.id !== assistantId);
        useBlockStore.getState().updateData(instanceId, {
            ...latest,
            isThinking,
            lastContextUpdate: Date.now(),
            messages: [
                ...withoutDraft,
                {
                    id: assistantId,
                    role: 'assistant' as const,
                    content,
                    timestamp: Date.now(),
                    sourcedFrom: turnSources.map(x => x.id),
                    sources: turnSources,
                    ...(turnRunId ? { runId: turnRunId } : {}),
                    ...(extra?.stopped ? { stopped: true } : {})
                }
            ]
        });
    };

    const controller = new AbortController();
    inflight.set(instanceId, controller);

    try {
        const gen = streamPersonaTurn({
            instanceId,
            personaType: current.personaType,
            customName: current.customName,
            history: historyForEngine,
            userMessage,
            abortSignal: controller.signal,
            onPrepared: (sources) => {
                const incoming = useWireStore.getState().getWiresToBlock(instanceId);
                const contributing = new Set(sources.map(s => s.id));
                useUIStore.getState().setReadingWires(
                    incoming.filter(w => contributing.has(w.sourceBlockId)).map(w => w.id)
                );
            }
        });

        let lastCommit = 0;
        let result = await gen.next();
        while (!result.done) {
            acc += result.value;
            const now = Date.now();
            if (now - lastCommit >= STREAM_COMMIT_MS) {
                lastCommit = now;
                commit(acc, true);
            }
            result = await gen.next();
        }

        const final = result.value;
        turnSources = final.sources;
        turnRunId = final.runId;

        if (final.stopped) {
            if (acc.trim() || final.content?.trim()) {
                commit(acc || final.content || '', false, { stopped: true });
            } else {
                const latest =
                    (useBlockStore.getState().getBlock(instanceId)?.data as PersonaBlockData) || current;
                useBlockStore.getState().updateData(instanceId, {
                    ...latest,
                    isThinking: false,
                    messages: latest.messages.filter(m => m.id !== assistantId)
                });
            }
            return { ran: true, success: true, stopped: true };
        }

        if (!final.success) {
            // No answer was produced, so no source informed one (FINDINGS.md).
            turnSources = [];
            commit(`⚠️ ${final.error}`, false);
            return { ran: true, success: false, error: final.error };
        }

        commit(final.content || acc, false);
        return { ran: true, success: true };
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            if (acc.trim()) {
                commit(acc, false, { stopped: true });
            } else {
                const latest =
                    (useBlockStore.getState().getBlock(instanceId)?.data as PersonaBlockData) || current;
                useBlockStore.getState().updateData(instanceId, {
                    ...latest,
                    isThinking: false,
                    messages: latest.messages.filter(m => m.id !== assistantId)
                });
            }
            return { ran: true, success: true, stopped: true };
        }
        const message = err instanceof Error ? err.message : 'Something went wrong.';
        commit(`⚠️ ${message}`, false);
        return { ran: true, success: false, error: message };
    } finally {
        inflight.delete(instanceId);
        useUIStore.getState().setReadingWires([]);
    }
}
