// ============================================
// PROVENANCE — what actually fed a persona turn.
//
// The product's central claim is that a persona's context is inspectable.
// These lock the two ways that claim can quietly become false:
//   1. citing wires that carried no data (overstating the grounding), and
//   2. letting anything reach a prompt without arriving through a wire.
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { aggregateWireContext } from './wire.service';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { DataWire } from '@/core/schemas/wire.schema';

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

function wire(id: string, from: string, to: string, status: DataWire['status'] = 'active'): DataWire {
    return {
        id,
        sourceBlockId: from,
        targetBlockId: to,
        wireType: 'data',
        status,
        filters: { ...DEFAULT_WIRE_FILTERS },
        shellId: 'root',
        createdAt: Date.now()
    } as unknown as DataWire;
}


function memoryBlock(id: string, name: string, contents: string[]): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'memory_pool', display_name: name, category: 'model' },
        status: 'connected',
        last_updated: Date.now(),
        data: {
            poolId: 'memory',
            limit: 10,
            entries: contents.map((content, i) => ({
                id: `${id}-e${i}`,
                type: 'memory',
                content,
                importance: 0.5,
                timestamp: Date.now()
            }))
        },
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId: 'root'
    } as unknown as BlockInstance;
}


function personaBlock(id: string, name: string, messages: Array<{role: string; content: string}>): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'persona_analyst', display_name: name, category: 'model' },
        status: 'connected',
        last_updated: Date.now(),
        data: {
            personaType: 'analyst',
            messages: messages.map((m, i) => ({ id: `${id}-m${i}`, timestamp: Date.now(), ...m })),
            memory: [],
            isCollapsed: false,
            isThinking: false
        },
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId: 'root'
    } as unknown as BlockInstance;
}

const PERSONA = 'persona-1';

function seedPersona() {
    return block(PERSONA, 'Analyst', {
        personaType: 'analyst',
        messages: [],
        memory: [],
        isCollapsed: false,
        isThinking: false
    });
}

beforeEach(() => {
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

describe('aggregateWireContext — wired sources', () => {
    it('names each contributing block, not just its id', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), block('src-1', 'FRED Series', { value: 42 })],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'src-1', PERSONA)] });

        const { sources } = aggregateWireContext(PERSONA);
        const wired = sources.filter(s => s.kind === 'wire');

        expect(wired).toHaveLength(1);
        expect(wired[0]).toMatchObject({ id: 'src-1', kind: 'wire', label: 'FRED Series' });
    });

    it('does NOT cite a connected wire whose source carried no data', () => {
        // The old UI recorded every connected wire, so an empty source still
        // appeared as grounding. Provenance has to mean "fed this answer".
        useBlockStore.setState({
            blocks: [seedPersona(), block('empty', 'Empty Feed', null)],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'empty', PERSONA)] });

        const { sources } = aggregateWireContext(PERSONA);
        expect(sources.filter(s => s.kind === 'wire')).toHaveLength(0);
    });

    it('does NOT cite a source whose items array is empty', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), block('empty', 'Empty Feed', { items: [] })],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'empty', PERSONA)] });

        const { sources, sourceIds, context } = aggregateWireContext(PERSONA);
        expect(sources).toHaveLength(0);
        expect(sourceIds).toHaveLength(0);
        expect(context).not.toContain('(No data)');
    });

    it('does NOT cite a source whose data is an empty object', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), block('empty', 'Empty Feed', {})],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'empty', PERSONA)] });

        const { sources, sourceIds, context } = aggregateWireContext(PERSONA);
        expect(sources).toHaveLength(0);
        expect(sourceIds).toHaveLength(0);
        expect(context).not.toContain('{}');
    });

    it('still cites a source whose items array has content', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                block('full', 'Full Feed', { items: [{ id: 'a', title: 'Headline', metadata: {} }] })
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'full', PERSONA)] });

        const { sources, context } = aggregateWireContext(PERSONA);
        expect(sources.filter(s => s.kind === 'wire')).toMatchObject([
            { id: 'full', label: 'Full Feed' }
        ]);
        expect(context).toContain('Headline');
    });

    it('cites only the sources that carried data when some wired sources are empty', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                block('empty', 'Empty Feed', { items: [] }),
                block('full', 'Full Feed', { items: [{ id: 'a', title: 'Headline', metadata: {} }] })
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [wire('w1', 'empty', PERSONA), wire('w2', 'full', PERSONA)]
        });

        const { sources, sourceIds } = aggregateWireContext(PERSONA);
        expect(sources.map(s => s.id)).toEqual(['full']);
        expect(sourceIds).toEqual(['full']);
    });

    it('ignores wires that are not active', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), block('src-1', 'Stale Source', { value: 1 })],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'src-1', PERSONA, 'stale')] });

        expect(aggregateWireContext(PERSONA).sources).toHaveLength(0);
    });

    it('sources and sourceIds agree for wired blocks', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                block('a', 'Alpha', { value: 1 }),
                block('b', 'Beta', { value: 2 })
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [wire('w1', 'a', PERSONA), wire('w2', 'b', PERSONA)]
        });

        const { sources, sourceIds } = aggregateWireContext(PERSONA);
        expect(sources.filter(s => s.kind === 'wire').map(s => s.id)).toEqual(sourceIds);
    });
});

describe('aggregateWireContext — memory is wired, not injected', () => {
    it('a Memory block is cited by kind, distinct from live data', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                block('src-fred', 'FRED Series', { value: 42 }),
                memoryBlock('mem-1', 'Long-term memory', ['Rates held steady.'])
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [wire('w1', 'src-fred', PERSONA), wire('w2', 'mem-1', PERSONA)]
        });

        const { sources, context } = aggregateWireContext(PERSONA);

        expect(sources.find(s => s.id === 'src-fred')?.kind).toBe('wire');
        expect(sources.find(s => s.id === 'mem-1')?.kind).toBe('memory');
        expect(context).toContain('Rates held steady.');
    });

    it('cutting the wire removes the memory — the point of making it a block', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), memoryBlock('mem-1', 'Long-term memory', ['Secret.'])],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'mem-1', PERSONA)] });
        expect(aggregateWireContext(PERSONA).context).toContain('Secret.');

        useWireStore.setState({ wires: [] });
        const after = aggregateWireContext(PERSONA);
        expect(after.context).not.toContain('Secret.');
        expect(after.sources).toHaveLength(0);
    });

    it('an empty Memory block is not a source — an empty pool grounds nothing', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), memoryBlock('mem-1', 'Long-term memory', [])],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'mem-1', PERSONA)] });

        // Citing a pool that holds nothing would say "grounded in memory"
        // about an answer that used none. The wire's stale/empty status is
        // the UI's job; provenance only lists what carried data.
        const { context, sources, sourceIds } = aggregateWireContext(PERSONA);
        expect(sources).toHaveLength(0);
        expect(sourceIds).toHaveLength(0);
        expect(context).not.toContain('(No entries)');
    });

    it('a persona with no wires at all is grounded in nothing', () => {
        useBlockStore.setState({ blocks: [seedPersona()], activeShellId: 'root' });
        useWireStore.setState({ wires: [] });

        const { sources, sourceIds } = aggregateWireContext(PERSONA);
        // Previously a hidden toggle could make this untrue without any
        // on-screen sign. There is no such path now.
        expect(sources).toHaveLength(0);
        expect(sourceIds).toHaveLength(0);
    });
});

describe('persona as a source — the cascade', () => {
    it("passes on the conclusion, not the persona's internals", () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                personaBlock('up-1', 'Analyst', [
                    { role: 'user', content: 'What do you see?' },
                    { role: 'assistant', content: 'Rates are steady near 4.2%.' }
                ])
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'up-1', PERSONA)] });

        const { context, sources } = aggregateWireContext(PERSONA);

        expect(context).toContain('Rates are steady near 4.2%.');
        // The regression: this used to be a JSON dump of the whole block.
        expect(context).not.toContain('isCollapsed');
        expect(context).not.toContain('personaType');
        expect(context).not.toContain('timestamp');
        expect(sources.find(s => s.id === 'up-1')?.kind).toBe('inference');
    });

    it('uses the latest answer when the conversation continued', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                personaBlock('up-1', 'Analyst', [
                    { role: 'assistant', content: 'First take.' },
                    { role: 'user', content: 'And now?' },
                    { role: 'assistant', content: 'Revised take.' }
                ])
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'up-1', PERSONA)] });

        const { context } = aggregateWireContext(PERSONA);
        expect(context).toContain('Revised take.');
        expect(context).not.toContain('First take.');
    });

    it('does not propagate an upstream failure as if it were analysis', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                personaBlock('up-1', 'Analyst', [
                    { role: 'assistant', content: '⚠️ No LLM available — set the key in .env.' }
                ])
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'up-1', PERSONA)] });

        // One broken persona should not become two.
        expect(aggregateWireContext(PERSONA).sources).toHaveLength(0);
    });

    it('a persona that has not answered yet is not a source', () => {
        useBlockStore.setState({
            blocks: [seedPersona(), personaBlock('up-1', 'Analyst', [])],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'up-1', PERSONA)] });

        expect(aggregateWireContext(PERSONA).sources).toHaveLength(0);
    });

    it('distinguishes all three kinds of evidence in one turn', () => {
        useBlockStore.setState({
            blocks: [
                seedPersona(),
                block('data-1', 'FRED Series', { value: 42 }),
                memoryBlock('mem-1', 'Long-term memory', ['We decided to wait.']),
                personaBlock('up-1', 'Analyst', [{ role: 'assistant', content: 'Steady.' }])
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [
                wire('w1', 'data-1', PERSONA),
                wire('w2', 'mem-1', PERSONA),
                wire('w3', 'up-1', PERSONA)
            ]
        });

        const kinds = Object.fromEntries(
            aggregateWireContext(PERSONA).sources.map(s => [s.id, s.kind])
        );
        expect(kinds).toEqual({
            'data-1': 'wire',
            'mem-1': 'memory',
            'up-1': 'inference'
        });
    });
});
