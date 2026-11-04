// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { WireRenderer } from './WireRenderer';
import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import { DEFAULT_WIRE_FILTERS } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { DataWire } from '@/core/schemas/wire.schema';

function block(id: string, x: number): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'x', display_name: id, category: 'truth' },
        status: 'connected',
        last_updated: Date.now(),
        data: { value: 1 },
        position: { x, y: 0 },
        dimensions: { width: 100, height: 80 },
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

beforeEach(() => {
    useBlockStore.setState({
        blocks: [block('src', 0), block('dst', 300)],
        activeShellId: 'root'
    });
    useWireStore.setState({ wires: [wire('w-live', 'src', 'dst')] } as never);
});

describe('WireRenderer', () => {
    it('draws a live wire with its id and both endpoints', () => {
        const { container } = render(<WireRenderer />);
        const drawn = container.querySelector('[data-testid="wire"]');
        expect(drawn?.getAttribute('data-wire-id')).toBe('w-live');
        expect(drawn?.getAttribute('data-source-id')).toBe('src');
        expect(drawn?.getAttribute('data-target-id')).toBe('dst');
    });
});
