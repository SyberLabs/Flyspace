// ============================================
// PERSONA TURN — the visible read.
//
// A persona gathering context must light the wires that actually fed it.
// A connected empty source staying dark is the product teaching the user
// that provenance is honest, not decorative.
// ============================================

// fake-indexeddb gives the persisted stores a real (in-memory) vault, so the
// write-count tests below see the IndexedDB puts the app would make.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { vaultStorage } from '@/core/vault/vaultStorage';
import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import { useUIStore } from '@/core/stores/uiStore';
import { createPersonaBlockData, DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { DataWire, ContextSource, PersonaBlockData } from '@/core/schemas/wire.schema';
import type { PersonaTurnInput, PersonaTurnResult } from './persona.engine';

vi.mock('./persona.engine', () => ({
    streamPersonaTurn: vi.fn()
}));
import { streamPersonaTurn } from './persona.engine';
import { runPersonaTurn, STREAM_COMMIT_MS, stopPersonaTurn, regeneratePersonaTurn } from './personaTurn.service';

const PERSONA = 'persona_1';

function block(id: string, name: string, data: unknown): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'x', display_name: name, category: 'truth' },
        status: 'connected',
        last_updated: Date.now(),
        data,
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId: 'root'
    } as unknown as BlockInstance;
}

function persona(): BlockInstance {
    return {
        instance_id: PERSONA,
        schema: { block_id: 'persona_analyst', display_name: 'Analyst', category: 'model' },
        status: 'connected',
        last_updated: Date.now(),
        data: createPersonaBlockData('analyst'),
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 400 },
        shellId: 'root'
    } as unknown as BlockInstance;
}

function wire(id: string, from: string, to: string): DataWire {
    return {
        id,
        sourceBlockId: from,
        targetBlockId: to,
        wireType: 'push',
        status: 'active',
        filters: { ...DEFAULT_WIRE_FILTERS },
        shellId: 'root',
        createdAt: Date.now()
    } as unknown as DataWire;
}

function mockStream(opts: {
    sources: ContextSource[];
    chunks?: string[];
    result?: Partial<PersonaTurnResult>;
    throwAfterPrepare?: Error;
}) {
    vi.mocked(streamPersonaTurn).mockImplementation(async function* (input: PersonaTurnInput) {
        input.onPrepared?.(opts.sources);
        if (opts.throwAfterPrepare) throw opts.throwAfterPrepare;
        for (const c of opts.chunks ?? ['ok']) yield c;
        return {
            success: true,
            content: (opts.chunks ?? ['ok']).join(''),
            sourceIds: opts.sources.map(s => s.id),
            sources: opts.sources,
            ...opts.result
        };
    });
}

beforeEach(() => {
    useBlockStore.setState({
        blocks: [
            persona(),
            block('fred', 'FRED Series', { value: 42 }),
            block('empty', 'Empty Feed', null)
        ],
        activeShellId: 'root'
    });
    useWireStore.setState({
        wires: [
            wire('w-fred', 'fred', PERSONA),
            wire('w-empty', 'empty', PERSONA)
        ]
    } as never);
    useUIStore.setState({ readingWireIds: [] });
});

function personaData(): PersonaBlockData {
    return useBlockStore.getState().getBlock(PERSONA)!.data as PersonaBlockData;
}

function lastAssistant() {
    return personaData().messages.filter(m => m.role === 'assistant').at(-1);
}

describe('runPersonaTurn — fail-closed conversation', () => {
    it('commits a failure into the conversation as a visible warning', async () => {
        mockStream({
            sources: [],
            chunks: [],
            result: { success: false, error: 'No LLM available — start Ollama' }
        });

        const outcome = await runPersonaTurn(PERSONA);

        expect(outcome).toEqual({
            ran: true,
            success: false,
            error: 'No LLM available — start Ollama'
        });
        expect(lastAssistant()?.content).toBe('⚠️ No LLM available — start Ollama');
        expect(personaData().isThinking).toBe(false);
    });

    it('cites no source on a failed turn, even when wires carried data', async () => {
        mockStream({
            sources: [{ id: 'fred', kind: 'wire', label: 'FRED Series' }],
            chunks: [],
            result: { success: false, error: 'No LLM available' }
        });

        await runPersonaTurn(PERSONA);

        expect(lastAssistant()?.sources).toEqual([]);
        expect(lastAssistant()?.sourcedFrom).toEqual([]);
    });

    it('clears isThinking when the stream throws', async () => {
        mockStream({
            sources: [],
            throwAfterPrepare: new Error('stream died')
        });

        const outcome = await runPersonaTurn(PERSONA);

        expect(outcome.success).toBe(false);
        expect(personaData().isThinking).toBe(false);
        expect(lastAssistant()?.content).toBe('⚠️ stream died');
    });

    it('does not throw when the persona is missing', async () => {
        const outcome = await runPersonaTurn('no-such-block');
        expect(outcome).toEqual({
            ran: false,
            success: false,
            error: 'Persona block not found.'
        });
    });
});

describe('runPersonaTurn — streaming commits', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('throttles mid-stream drafts to the UI store and commits only the final answer', async () => {
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => now);

        const drafts: string[] = [];
        const unsubDrafts = useUIStore.subscribe((state) => {
            const draft = state.drafts[PERSONA];
            if (draft) drafts.push(draft);
        });
        const committed: string[] = [];
        const unsubBlocks = useBlockStore.subscribe((state) => {
            const data = state.getBlock(PERSONA)?.data as PersonaBlockData | undefined;
            const last = data?.messages.filter(m => m.role === 'assistant').at(-1);
            if (last) committed.push(last.content);
        });

        vi.mocked(streamPersonaTurn).mockImplementation(async function* (input: PersonaTurnInput) {
            input.onPrepared?.([]);
            now = 0;
            yield 'A';
            now = 40;
            yield 'B';
            now = STREAM_COMMIT_MS;
            yield 'C';
            now = STREAM_COMMIT_MS + 1;
            yield 'D';
            return {
                success: true,
                content: 'ABCD',
                sourceIds: [],
                sources: []
            };
        });

        await runPersonaTurn(PERSONA);
        unsubDrafts();
        unsubBlocks();

        expect(drafts).toContain('ABC');
        expect(drafts.filter(c => c === 'AB')).toHaveLength(0);
        // The persisted block never saw a draft: one assistant message, the answer.
        expect(committed).toEqual(['ABCD']);
        expect(lastAssistant()?.content).toBe('ABCD');
        expect(personaData().isThinking).toBe(false);
        expect(useUIStore.getState().drafts[PERSONA]).toBeUndefined();
    });
});

describe('runPersonaTurn — persisted writes during a stream (O4)', () => {
    /** A 2 s stream: one chunk every STREAM_COMMIT_MS. */
    const CHUNKS = 2000 / STREAM_COMMIT_MS; // 25

    /** IndexedDB requests are issued after the persist adapter awaits its connection. */
    const settle = () => new Promise(r => setTimeout(r, 30));

    function putsFor(spy: { mock: { calls: unknown[][] } }, key: string): number {
        return spy.mock.calls.filter(call => call[1] === key).length;
    }

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('before: a store that commits every draft puts its whole blob once per commit', async () => {
        const committing = create<{ messages: string[] }>()(
            persist(() => ({ messages: [] as string[] }), {
                name: 'omni-bench-drafts',
                storage: createJSONStorage(() => vaultStorage)
            })
        );
        await settle(); // hydration write
        const put = vi.spyOn(IDBObjectStore.prototype, 'put');

        let draft = '';
        for (let i = 0; i < CHUNKS; i++) {
            draft += `token${i} `;
            committing.setState({ messages: [draft] });
        }
        await settle();

        expect(putsFor(put, 'omni-bench-drafts')).toBeGreaterThanOrEqual(CHUNKS);
    });

    it('after: a 2 s persona stream puts the blocks blob at turn start and turn end only', async () => {
        let now = 0;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        vi.mocked(streamPersonaTurn).mockImplementation(async function* (input: PersonaTurnInput) {
            input.onPrepared?.([]);
            for (let i = 0; i < CHUNKS; i++) {
                now += STREAM_COMMIT_MS;
                yield `token${i} `;
            }
            return { success: true, content: 'answer', sourceIds: [], sources: [] };
        });
        await settle(); // beforeEach's setState lands before counting starts
        const put = vi.spyOn(IDBObjectStore.prototype, 'put');

        await runPersonaTurn(PERSONA);
        await settle();

        expect(putsFor(put, 'omni-blocks')).toBeLessThanOrEqual(2);
        expect(lastAssistant()?.content).toBe('answer');
    });
});

describe('runPersonaTurn — provenance is the turn\'s', () => {
    it('records the turn sources, not every connected wire', async () => {
        mockStream({
            sources: [{ id: 'fred', kind: 'wire', label: 'FRED Series' }],
            chunks: ['Grounded.']
        });

        await runPersonaTurn(PERSONA);

        const last = lastAssistant();
        expect(last?.sourcedFrom).toEqual(['fred']);
        expect(last?.sources).toEqual([{ id: 'fred', kind: 'wire', label: 'FRED Series' }]);
        expect(last?.sourcedFrom).not.toContain('empty');
    });

    it('cites nothing when the turn itself had no sources', async () => {
        mockStream({ sources: [], chunks: ['Ungrounded.'] });
        await runPersonaTurn(PERSONA);
        expect(lastAssistant()?.sources).toEqual([]);
        expect(lastAssistant()?.sourcedFrom).toEqual([]);
    });
});

describe('runPersonaTurn — reading wires are the contributing ones', () => {
    it('puts a contributing wire in readingWireIds and leaves an empty one dark', async () => {
        let during: string[] | undefined;
        mockStream({
            sources: [{ id: 'fred', kind: 'wire', label: 'FRED Series' }],
            chunks: ['token']
        });
        // Intercept setReadingWires so we can see the during-turn set
        // without racing the finally-clear.
        const original = useUIStore.getState().setReadingWires;
        useUIStore.setState({
            setReadingWires: (ids: string[]) => {
                if (ids.length > 0) during = ids;
                original(ids);
            }
        });

        await runPersonaTurn(PERSONA);

        expect(during).toEqual(['w-fred']);
        expect(during).not.toContain('w-empty');
    });

    it('clears readingWireIds after a successful turn', async () => {
        mockStream({
            sources: [{ id: 'fred', kind: 'wire', label: 'FRED Series' }]
        });
        await runPersonaTurn(PERSONA);
        expect(useUIStore.getState().readingWireIds).toEqual([]);
    });

    it('clears readingWireIds after a failed turn', async () => {
        mockStream({
            sources: [{ id: 'fred', kind: 'wire', label: 'FRED Series' }],
            throwAfterPrepare: new Error('stream died')
        });
        await runPersonaTurn(PERSONA);
        expect(useUIStore.getState().readingWireIds).toEqual([]);
    });
});

describe('runPersonaTurn — stop keeps the partial', () => {
    it('keeps streamed tokens and marks the message stopped, not failed', async () => {
        vi.mocked(streamPersonaTurn).mockImplementation(async function* (input: PersonaTurnInput) {
            input.onPrepared?.([]);
            yield 'Partial insight';
            await new Promise<void>((resolve) => {
                if (input.abortSignal?.aborted) {
                    resolve();
                    return;
                }
                input.abortSignal?.addEventListener('abort', () => resolve());
            });
            return {
                success: true,
                content: 'Partial insight',
                sourceIds: [],
                sources: [],
                stopped: true
            };
        });

        const turn = runPersonaTurn(PERSONA);
        await vi.waitFor(() => {
            expect(personaData().isThinking).toBe(true);
        });
        expect(stopPersonaTurn(PERSONA)).toBe(true);
        const outcome = await turn;

        expect(outcome).toMatchObject({ ran: true, success: true, stopped: true });
        expect(lastAssistant()?.content).toBe('Partial insight');
        expect(lastAssistant()?.stopped).toBe(true);
        expect(lastAssistant()?.content.startsWith('⚠️')).toBe(false);
        expect(personaData().isThinking).toBe(false);
        expect(useUIStore.getState().readingWireIds).toEqual([]);
    });
});

describe('regeneratePersonaTurn', () => {
    it('drops the last assistant message and re-runs the same Think', async () => {
        mockStream({ sources: [], chunks: ['First.'] });
        await runPersonaTurn(PERSONA);
        expect(lastAssistant()?.content).toBe('First.');

        mockStream({ sources: [], chunks: ['Second.'] });
        const outcome = await regeneratePersonaTurn(PERSONA);

        expect(outcome.success).toBe(true);
        const assistants = personaData().messages.filter(m => m.role === 'assistant');
        expect(assistants).toHaveLength(1);
        expect(assistants[0].content).toBe('Second.');
    });

    it('re-runs a chat turn without duplicating the user message', async () => {
        mockStream({ sources: [], chunks: ['Reply one.'] });
        await runPersonaTurn(PERSONA, 'What do you see?');
        expect(personaData().messages.filter(m => m.role === 'user')).toHaveLength(1);

        mockStream({ sources: [], chunks: ['Reply two.'] });
        await regeneratePersonaTurn(PERSONA);

        const users = personaData().messages.filter(m => m.role === 'user');
        expect(users).toHaveLength(1);
        expect(users[0].content).toBe('What do you see?');
        expect(lastAssistant()?.content).toBe('Reply two.');
    });
});
