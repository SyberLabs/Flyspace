// ============================================
// PROJECT OMNI: BLOCK STORE
// The blocks on the canvas. Persisted to OmniVault so a canvas survives a
// reload; wires live alongside in wireStore and the two move together.
// ============================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
    BlockInstance,
    ConnectionStatus,
    OmniBlockSchema
} from '../schemas/block.schema';
import { vaultStorage } from '../vault';
import { newId } from '../id';
import { admitField, admitRecords, type Shape } from '../vault/hydration';
import { useWireStore } from './wireStore';
import { findFreeSpot } from './placement';

/** What a persisted BlockInstance must carry to be read back (see vault/hydration). */
const BLOCK_INSTANCE_SHAPE = {
    instance_id: 'string',
    schema: {
        block_id: 'string',
        display_name: 'string',
        category: 'string',
        semantic_tags: 'array'
    },
    status: 'string',
    last_updated: 'number|null',
    position: { x: 'number', y: 'number' },
    dimensions: { width: 'number', height: 'number' },
    shellId: 'string'
} as const satisfies Shape<BlockInstance>;

/**
 * omni-blocks persist migrations.
 * v0 → v1: drop the legacy dual-wire `connections` field.
 * v1 → v2: params is optional. Leave it absent — undefined means never configured.
 * Do not backfill fetch defaults into persisted records.
 */
export function migrateBlockStore(
    persistedState: unknown,
    fromVersion: number
): Record<string, unknown> {
    const persisted = { ...((persistedState || {}) as Record<string, unknown>) };
    if (fromVersion < 1) {
        delete persisted.connections;
    }
    return persisted;
}

// ============================================
// BLOCK STORE
// ============================================

interface BlockState {
    /** Active block instances on the canvas */
    blocks: BlockInstance[];

    /** Currently active shell ID */
    activeShellId: string;

    /** Add a new block to the canvas, at `position` or the nearest free spot to it */
    addBlock: (schema: OmniBlockSchema, position: { x: number; y: number }, shellId?: string) => string;

    /** Remove a block from the canvas */
    removeBlock: (instanceId: string) => void;

    /** Put a removed block back as it was (undo). Its wires are the wire store's job. */
    restoreBlock: (block: BlockInstance) => void;

    /** Update block position */
    updatePosition: (instanceId: string, position: { x: number; y: number }) => void;

    /** Update block dimensions */
    updateDimensions: (instanceId: string, dimensions: { width: number; height: number }) => void;

    /** Update block data */
    updateData: (instanceId: string, data: unknown) => void;

    /** Update block status */
    updateStatus: (instanceId: string, status: ConnectionStatus, error?: string) => void;

    /** Merge fetch/config knobs onto a block. Partial; does not replace siblings. */
    setParams: (instanceId: string, params: Record<string, unknown>) => void;

    /** Clear all blocks and wires on the active shell */
    clearCanvas: () => void;

    /** Get a block by ID */
    getBlock: (instanceId: string) => BlockInstance | undefined;

    /** Get blocks for a specific shell */
    getBlocksByShell: (shellId: string) => BlockInstance[];

    /** Set the active shell */
    setActiveShell: (shellId: string) => void;

    /** Clear all blocks and wires in a specific shell */
    clearShell: (shellId: string) => void;
}

/** Header, run button and a few result rows, plus about one field row per input. */
/**
 * Tall enough for the fields the block shows when placed: each required
 * input (a field, its label, a line of help), plus one line for the fold
 * that holds the optional ones. A one-value input is filled, not shown.
 */
function capabilityHeight(schema: OmniBlockSchema): number {
    const inbound = schema.ports?.find(port => port.direction === 'input')?.schema;
    const properties = Object.entries(inbound?.properties ?? {});
    const required = new Set(inbound?.required ?? []);
    const shown = properties.filter(([name, value]) => required.has(name) && value.enum?.length !== 1).length;
    const folded = properties.some(([name]) => !required.has(name)) ? 1 : 0;
    return Math.min(560, Math.max(280, 220 + shown * 64 + folded * 28));
}

export const useBlockStore = create<BlockState>()(
    persist(
        (set, get) => ({
            blocks: [],
            activeShellId: 'root',

            addBlock: (schema, position, shellId) => {
                const instanceId = `${schema.block_id}_${newId()}`;

                // Persona blocks need more height for chat interface; an API
                // block needs room for one field per input plus its result.
                const isPersonaBlock = schema.block_id.startsWith('persona_');
                const defaultHeight = isPersonaBlock ? 400 : schema.capabilityId ? capabilityHeight(schema) : 240;
                const dimensions = { width: 320, height: defaultHeight };
                const targetShell = shellId || get().activeShellId;  // Use active shell when not specified

                // Never on top of another block: the requested point if it is
                // free, else the nearest free spot on this shell.
                const occupied = get().blocks
                    .filter(b => b.shellId === targetShell)
                    .map(b => ({ ...b.position, ...b.dimensions }));

                const newBlock: BlockInstance = {
                    instance_id: instanceId,
                    schema,
                    status: 'disconnected',
                    last_updated: null,
                    data: null,
                    position: findFreeSpot(occupied, position, dimensions),
                    dimensions,
                    shellId: targetShell
                };

                set(state => ({
                    blocks: [...state.blocks, newBlock]
                }));

                return instanceId;
            },

            removeBlock: (instanceId) => {
                set(state => ({
                    blocks: state.blocks.filter(b => b.instance_id !== instanceId)
                }));
                // Single wire system: clean up any wires touching this block
                // (previously orphaned wires lingered forever).
                useWireStore.getState().removeWiresForBlock(instanceId);
            },

            restoreBlock: (block) => {
                set(state => ({
                    blocks: state.blocks.some(b => b.instance_id === block.instance_id)
                        ? state.blocks
                        : [...state.blocks, block]
                }));
            },

            updatePosition: (instanceId, position) => {
                set(state => ({
                    blocks: state.blocks.map(b =>
                        b.instance_id === instanceId ? { ...b, position } : b
                    )
                }));
            },

            updateDimensions: (instanceId, dimensions) => {
                set(state => ({
                    blocks: state.blocks.map(b =>
                        b.instance_id === instanceId ? { ...b, dimensions } : b
                    )
                }));
            },

            updateData: (instanceId, data) => {
                set(state => ({
                    blocks: state.blocks.map(b =>
                        b.instance_id === instanceId
                            ? { ...b, data, last_updated: Date.now() }
                            : b
                    )
                }));

            },

            updateStatus: (instanceId, status, error) => {
                set(state => ({
                    blocks: state.blocks.map(b =>
                        b.instance_id === instanceId ? { ...b, status, error } : b
                    )
                }));
            },

            setParams: (instanceId, params) => {
                set(state => ({
                    blocks: state.blocks.map(b =>
                        b.instance_id === instanceId
                            ? { ...b, params: { ...b.params, ...params } }
                            : b
                    )
                }));
            },

            clearCanvas: () => {
                // Clear only the active shell
                const activeShellId = get().activeShellId;
                get().clearShell(activeShellId);
            },

            getBlock: (instanceId) => {
                return get().blocks.find(b => b.instance_id === instanceId);
            },

            getBlocksByShell: (shellId) => {
                return get().blocks.filter(b => b.shellId === shellId);
            },

            setActiveShell: (shellId) => {
                set({ activeShellId: shellId });
            },

            clearShell: (shellId) => {
                set(state => ({
                    blocks: state.blocks.filter(b => b.shellId !== shellId)
                }));
                // Single wire system: a shell's wires die with its blocks.
                useWireStore.getState().removeWiresByShell(shellId);
            }
        }),
        {
            name: 'omni-blocks',
            version: 2,
            // OmniVault (IndexedDB): core canvas state outgrew localStorage (A2).
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({
                blocks: state.blocks,
                activeShellId: state.activeShellId
            }),
            migrate: migrateBlockStore,
            merge: (persistedState, currentState) => {
                if (!persistedState) return currentState;
                const persisted = persistedState as Record<string, unknown>;
                return {
                    ...currentState,
                    blocks: admitRecords<BlockInstance>('omni-blocks', 'blocks', persisted.blocks, BLOCK_INSTANCE_SHAPE),
                    activeShellId: admitField<string>('omni-blocks', persisted, 'activeShellId', 'string')
                        ?? currentState.activeShellId
                };
            }
        }
    )
);
