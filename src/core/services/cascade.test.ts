// ============================================
// CASCADE — cascade resolves which minds run and in what order.
// ============================================

import { describe, it, expect, beforeEach } from 'vitest';
import { planCascade, hasUpstreamPersonas } from './cascade.service';
import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import { DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { DataWire } from '@/core/schemas/wire.schema';

function persona(id: string, name = 'Analyst'): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'persona_analyst', display_name: name, category: 'model' },
        status: 'connected',
        last_updated: Date.now(),
        data: { personaType: 'analyst', messages: [], memory: [], isCollapsed: false, isThinking: false },
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 400 },
        shellId: 'root'
    } as unknown as BlockInstance;
}

function dataBlock(id: string): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'fred_series', display_name: 'FRED', category: 'truth' },
        status: 'connected',
        last_updated: Date.now(),
        data: { value: 1 },
        position: { x: 0, y: 0 },
        dimensions: { width: 1, height: 1 },
        shellId: 'root'
    } as unknown as BlockInstance;
}

function wire(id: string, from: string, to: string): DataWire {
    return {
        id,
        sourceBlockId: from,
        targetBlockId: to,
        wireType: 'data',
        status: 'active',
        filters: { ...DEFAULT_WIRE_FILTERS },
        shellId: 'root',
        createdAt: Date.now()
    } as unknown as DataWire;
}

beforeEach(() => {
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
});

describe('planCascade', () => {
    it('runs a lone persona as a chain of one', () => {
        useBlockStore.setState({ blocks: [persona('p1')], activeShellId: 'root' });
        expect(planCascade('p1').order).toEqual(['p1']);
        expect(hasUpstreamPersonas('p1')).toBe(false);
    });

    it('runs upstream before downstream', () => {
        useBlockStore.setState({ blocks: [persona('analyst'), persona('strategist')], activeShellId: 'root' });
        useWireStore.setState({ wires: [wire('w1', 'analyst', 'strategist')] });

        expect(planCascade('strategist').order).toEqual(['analyst', 'strategist']);
        expect(hasUpstreamPersonas('strategist')).toBe(true);
    });

    it('orders a three-deep chain', () => {
        useBlockStore.setState({
            blocks: [persona('a'), persona('b'), persona('c')],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'a', 'b'), wire('w2', 'b', 'c')] });

        expect(planCascade('c').order).toEqual(['a', 'b', 'c']);
    });

    it('runs a shared upstream once, not twice', () => {
        // a feeds both b and c; c also depends on b.
        useBlockStore.setState({
            blocks: [persona('a'), persona('b'), persona('c')],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [wire('w1', 'a', 'b'), wire('w2', 'a', 'c'), wire('w3', 'b', 'c')]
        });

        const order = planCascade('c').order;
        expect(order).toEqual(['a', 'b', 'c']);
        expect(new Set(order).size).toBe(order.length);
    });

    it('ignores data blocks — they are fetched, not run', () => {
        useBlockStore.setState({
            blocks: [dataBlock('fred'), persona('p1')],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'fred', 'p1')] });

        expect(planCascade('p1').order).toEqual(['p1']);
        expect(hasUpstreamPersonas('p1')).toBe(false);
    });

    it('survives a cycle instead of hanging', () => {
        // Nothing stops a user wiring two personas to each other.
        useBlockStore.setState({ blocks: [persona('a'), persona('b')], activeShellId: 'root' });
        useWireStore.setState({ wires: [wire('w1', 'a', 'b'), wire('w2', 'b', 'a')] });

        const plan = planCascade('b');
        expect(plan.hadCycle).toBe(true);
        expect(plan.order).toHaveLength(2);
        expect(plan.order[plan.order.length - 1]).toBe('b');
    });
});
