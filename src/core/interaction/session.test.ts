import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { spatialSession } from './session';
import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import type { BlockInstance, PortSchema } from '@/core/schemas/block.schema';

// The store-backed mutator. Undoing a delete must hand the block and its
// wires back through the same admission every other wire path runs.

const jsonOut: PortSchema = { id: 'out', direction: 'output', dataType: 'json' };
const textIn: PortSchema = { id: 'in', direction: 'input', dataType: 'text' };
const anyIn: PortSchema = { id: 'in', direction: 'input', dataType: 'any' };

function block(id: string, ports: PortSchema[]): BlockInstance {
    return {
        instance_id: id,
        schema: {
            block_id: `test_${id}`,
            display_name: id,
            category: 'workspace',
            semantic_tags: [],
            ports
        },
        status: 'disconnected',
        last_updated: null,
        data: null,
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 120 },
        shellId: 'root'
    };
}

function deleteBlock(id: string): void {
    spatialSession.select([id]);
    expect(spatialSession.speak('delete this').lifecycle).toBe('previewing');
    expect(spatialSession.confirm()?.lifecycle).toBe('committed');
    expect(useBlockStore.getState().getBlock(id)).toBeUndefined();
    expect(useWireStore.getState().wires).toHaveLength(0);
}

describe('undo of a delete', () => {
    let warn: MockInstance<typeof console.warn>;
    let wireId: string;

    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        useBlockStore.setState({ blocks: [block('src', [jsonOut]), block('dst', [anyIn])], activeShellId: 'root' });
        useWireStore.setState({ wires: [], lastAdmissionRefusal: null });
        wireId = useWireStore.getState().addWire('src', 'dst');
        expect(wireId).not.toBe('');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('restores the block and its wires', () => {
        deleteBlock('dst');

        expect(spatialSession.undo()).toBe(true);

        expect(useBlockStore.getState().getBlock('dst')?.instance_id).toBe('dst');
        expect(useWireStore.getState().wires).toEqual([
            expect.objectContaining({ id: wireId, sourceBlockId: 'src', targetBlockId: 'dst', shellId: 'root' })
        ]);
        expect(warn).not.toHaveBeenCalled();
    });

    it('re-admits the wires, so one the canvas now refuses stays gone', () => {
        deleteBlock('src');
        // While the source was gone the target grew a typed text input.
        useBlockStore.setState({ blocks: [block('dst', [textIn])] });

        expect(spatialSession.undo()).toBe(true);

        expect(useBlockStore.getState().getBlock('src')?.instance_id).toBe('src');
        expect(useWireStore.getState().wires).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain(`dropped saved wire ${wireId}`);
        expect(warn.mock.calls[0][0]).toContain('incompatible-type');
    });

    it('does not duplicate a wire the canvas already has back', () => {
        const saved = useWireStore.getState().getWire(wireId)!;
        deleteBlock('dst');
        // Between the delete and its undo, a shell load (say, an undone
        // navigation) restored the block and the same wire from the saved shell.
        useBlockStore.getState().restoreBlock(block('dst', [anyIn]));
        useWireStore.getState().replaceWiresForShell('root', [saved]);
        expect(useWireStore.getState().wires).toHaveLength(1);

        expect(spatialSession.undo()).toBe(true);

        expect(useBlockStore.getState().blocks.filter(b => b.instance_id === 'dst')).toHaveLength(1);
        expect(useWireStore.getState().wires.map(wire => wire.id)).toEqual([wireId]);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('pointer close through the engine', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        useBlockStore.setState({ blocks: [block('src', [jsonOut]), block('dst', [anyIn])], activeShellId: 'root' });
        useWireStore.setState({ wires: [], lastAdmissionRefusal: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('undo of a close restores the block and its wires', () => {
        const wireId = useWireStore.getState().addWire('src', 'dst');
        expect(spatialSession.pointerDelete('dst').lifecycle).toBe('committed');
        expect(useBlockStore.getState().getBlock('dst')).toBeUndefined();
        expect(useWireStore.getState().wires).toHaveLength(0);

        expect(spatialSession.undo()).toBe(true);

        expect(useBlockStore.getState().getBlock('dst')?.instance_id).toBe('dst');
        expect(useWireStore.getState().wires).toEqual([
            expect.objectContaining({ id: wireId, sourceBlockId: 'src', targetBlockId: 'dst' })
        ]);
    });
});
