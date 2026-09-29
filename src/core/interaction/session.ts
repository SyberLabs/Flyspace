// Store-backed canvas authority. Sensors do not import this module.

import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore } from '@/core/stores/blockStore';
import { useWireStore } from '@/core/stores/wireStore';
import type { BlockInstance } from '@/core/schemas/block.schema';
import { InteractionEngine, type CanvasMutator } from './engine';
import type { CanvasBlockView } from './types';

function view(block: BlockInstance): CanvasBlockView {
    return {
        id: block.instance_id,
        shellId: block.shellId,
        blockId: block.schema.block_id,
        name: block.schema.display_name,
        tags: block.schema.semantic_tags ?? [],
        x: block.position.x,
        y: block.position.y,
        width: block.dimensions.width,
        height: block.dimensions.height
    };
}

export function createStoreMutator(): CanvasMutator {
    return {
        listBlocks() {
            return useBlockStore.getState().blocks.map(view);
        },
        getInstance(id) {
            return useBlockStore.getState().getBlock(id);
        },
        activeShell() {
            return useBlockStore.getState().activeShellId;
        },
        move(id, x, y) {
            const block = useBlockStore.getState().getBlock(id);
            const from = { x: block?.position.x ?? 0, y: block?.position.y ?? 0 };
            useBlockStore.getState().updatePosition(id, { x, y });
            return from;
        },
        add(blockId, displayName, x, y) {
            const schema = blockRegistry.get(blockId);
            if (!schema) throw new Error(`Unknown block type: ${blockId}`);
            return useBlockStore.getState().addBlock({ ...schema, display_name: displayName }, { x, y });
        },
        remove(id) {
            const block = useBlockStore.getState().getBlock(id);
            if (!block) return undefined;
            useBlockStore.getState().removeBlock(id);
            return block;
        },
        restore(block) {
            useBlockStore.setState(state => ({ blocks: [...state.blocks, block] }));
        },
        connect(sourceId, targetId) {
            const wireId = useWireStore.getState().addWire(sourceId, targetId);
            if (!wireId) {
                return { ok: false, reason: useWireStore.getState().lastAdmissionRefusal ?? 'refused' };
            }
            return { ok: true, wireId };
        },
        disconnect(wireId) {
            useWireStore.getState().removeWire(wireId);
        },
        setGroup(ids, groupId) {
            for (const id of ids) {
                useBlockStore.getState().setParams(id, { spatialGroupId: groupId });
            }
        }
    };
}

export const spatialSession = new InteractionEngine(createStoreMutator());
