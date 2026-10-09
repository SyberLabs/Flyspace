// ============================================
// PROJECT OMNI: SHELL STORE
// A shell is a serialized canvas: blocks + wires + metadata. Every operation
// here has to move both stores together — saving one without the other is the
// one bug this area has actually shipped.
// ============================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { BlockInstance, BlockConnection } from '../schemas/block.schema';
import { ShellConfig, ShellBlockState, PersonaType, AestheticTheme } from '../schemas/shell.schema';
import { DataWire, DEFAULT_WIRE_FILTERS } from '../schemas/wire.schema';
import { vaultStorage } from '../vault';
import { admitField, admitRecords, type Shape } from '../vault/hydration';
import { useWireStore, DATA_WIRE_SHAPE } from './wireStore';
import { useBlockStore } from './blockStore';
import { blockRegistry } from '../registry/BlockRegistry';
import { newId } from '../id';
import type { ShellTemplate } from '../shells/templates';

/** What a persisted ShellConfig must carry to be read back (see vault/hydration). */
export const SHELL_CONFIG_SHAPE = {
    id: 'string',
    type: 'string',
    name: 'string',
    blocks: 'array',
    wires: 'array',
    persona: 'string',
    aesthetic: 'string',
    createdAt: 'number',
    updatedAt: 'number'
} as const satisfies Shape<ShellConfig>;

export const SHELL_BLOCK_SHAPE = {
    blockId: 'string',
    instanceId: 'string',
    position: { x: 'number', y: 'number' },
    dimensions: { width: 'number', height: 'number' }
} as const satisfies Shape<ShellBlockState>;

// ============================================
// SHELL STORE
// ============================================

/**
 * Convert legacy dual-wire-system BlockConnection[] (old persisted shells)
 * into DataWires owned by the given shell. Part of the A1 wire unification.
 */
function legacyConnectionsToWires(
    connections: BlockConnection[] | undefined,
    shellId: string
): DataWire[] {
    return (connections || []).map((c, i) => ({
        id: `wire_migrated_${shellId}_${i}`,
        sourceBlockId: c.sourceBlockId,
        targetBlockId: c.targetBlockId,
        wireType: 'push' as const,
        filters: { ...DEFAULT_WIRE_FILTERS },
        status: 'active' as const,
        shellId
    }));
}

interface ShellState {
    /** Available shell configurations */
    shells: ShellConfig[];

    /** Currently active shell ID */
    activeShellId: string | null;

    /** Hotkey slot assignments (1-9 → shellId) */
    hotkeySlots: Record<number, string>;

    /** Current persona */
    currentPersona: PersonaType;

    /** Current aesthetic */
    currentAesthetic: AestheticTheme;

    /** Create a new shell */
    createShell: (name: string, description?: string) => ShellConfig;

    /** Save ANY shell with metadata (universal save) */
    saveShell: (shellId: string, metadata?: Partial<ShellConfig>) => ShellConfig;

    /** Load a shell configuration with block recreation */
    loadShell: (shellId: string) => boolean;

    /** Duplicate a shell (for templates) */
    duplicateShell: (sourceShellId: string, name?: string) => ShellConfig | null;

    /** Instantiate a built-in shell template into a fresh, activated shell. */
    instantiateTemplate: (template: ShellTemplate, name?: string) => string | null;

    /** Assign shell to hotkey slot (1-9) */
    assignHotkey: (shellId: string, slot: number) => boolean;

    /** Delete a shell */
    deleteShell: (shellId: string) => void;

    /** Set current persona */
    setPersona: (persona: PersonaType) => void;

    /** Set current aesthetic */
    setAesthetic: (aesthetic: AestheticTheme) => void;

    /** Get active shell */
    getActiveShell: () => ShellConfig | undefined;
}

export const useShellStore = create<ShellState>()(
    persist(
        (set, get) => ({
            shells: [],
            activeShellId: null,
            hotkeySlots: {},
            currentPersona: 'analyst',
            currentAesthetic: 'command',

            createShell: (name, description) => {
                const now = Date.now();

                // A new shell starts EMPTY — it is not a copy of the current
                // canvas. (To snapshot the current canvas, use "Save Current".)
                const newShell: ShellConfig = {
                    id: `shell_${newId()}`,
                    type: 'custom',  // User-created shells are 'custom' type
                    name,
                    description,
                    blocks: [],
                    wires: [],
                    persona: get().currentPersona,
                    aesthetic: get().currentAesthetic,
                    createdAt: now,
                    updatedAt: now
                };

                set(state => ({
                    shells: [...state.shells, newShell],
                    activeShellId: newShell.id
                }));

                // Switch the block store to the new (empty) shell so the canvas
                // — which follows the active shell — shows a blank workspace.
                // Existing shells' blocks are untouched (kept under their own id).
                useBlockStore.getState().setActiveShell(newShell.id);

                return newShell;
            },

            deleteShell: (shellId) => {
                const blockStore = useBlockStore.getState();
                const wasActiveOnCanvas = blockStore.activeShellId === shellId;

                // Remove the shell's blocks/connections so they don't linger
                // orphaned under a dead shell id.
                blockStore.clearShell(shellId);

                // If the deleted shell was the one on the canvas, fall back to root.
                if (wasActiveOnCanvas) {
                    blockStore.setActiveShell('root');
                }

                set(state => ({
                    shells: state.shells.filter(s => s.id !== shellId),
                    activeShellId: state.activeShellId === shellId
                        ? (wasActiveOnCanvas ? 'root' : null)
                        : state.activeShellId
                }));
            },

            setPersona: (persona) => set({ currentPersona: persona }),

            setAesthetic: (aesthetic) => set({ currentAesthetic: aesthetic }),

            getActiveShell: () => {
                const state = get();
                return state.shells.find(s => s.id === state.activeShellId);
            },

            // NEW Phase 4 methods

            saveShell: (shellId, metadata) => {
                const blockStore = useBlockStore.getState();
                const wireStore = useWireStore.getState();

                // Snapshot the shell's LIVE blocks and wires. Fields the caller
                // does not pass come from the shell's existing record, so a
                // re-save keeps its identity (createdAt, hotkey, tags).
                const shellBlocks = blockStore.getBlocksByShell(shellId);
                const shellWires = wireStore.getWiresByShell(shellId);
                const existing = get().shells.find(s => s.id === shellId);
                const meta: Partial<ShellConfig> = { ...existing, ...metadata };

                const now = Date.now();
                const shellConfig: ShellConfig = {
                    id: shellId,
                    type: meta.type || 'custom',
                    name: meta.name || `Shell ${now}`,
                    description: meta.description,
                    systemType: meta.systemType,
                    blocks: shellBlocks.map(b => ({
                        blockId: b.schema.block_id,
                        instanceId: b.instance_id,
                        position: b.position,
                        dimensions: b.dimensions,
                        config: { data: b.data },
                        ...(b.params ? { params: b.params } : {})
                    })),
                    wires: shellWires,
                    persona: meta.persona || get().currentPersona,
                    aesthetic: meta.aesthetic || get().currentAesthetic,
                    hotkeySlot: meta.hotkeySlot,
                    isTemplate: meta.isTemplate,
                    templateTags: meta.templateTags,
                    createdAt: meta.createdAt || now,
                    updatedAt: now,
                    lastAccessedAt: now
                };

                set(state => ({
                    shells: [...state.shells.filter(s => s.id !== shellId), shellConfig]
                }));

                return shellConfig;
            },

            loadShell: (shellId) => {
                const shell = get().shells.find(s => s.id === shellId);
                if (!shell) return false;

                const blockStore = useBlockStore.getState();

                // Blocks and wires live in their stores keyed by shellId, and
                // stay there when the canvas shows another shell. A shell that
                // already has live blocks is only activated: its conversation,
                // fetched data and positions are what the user left. The saved
                // snapshot seeds the canvas only when nothing is live yet (a
                // fresh template, a shell restored from a file).
                if (blockStore.getBlocksByShell(shellId).length === 0) {
                    const recreatedBlocks: BlockInstance[] = [];
                    shell.blocks.forEach(savedBlock => {
                        const schema = blockRegistry.get(savedBlock.blockId);
                        if (!schema) {
                            console.warn(`Block schema not found for ${savedBlock.blockId}, skipping`);
                            return;
                        }

                        recreatedBlocks.push({
                            instance_id: savedBlock.instanceId,
                            schema,
                            status: 'disconnected',
                            last_updated: null,
                            data: savedBlock.config?.data || null,
                            position: savedBlock.position,
                            dimensions: savedBlock.dimensions,
                            shellId: shellId,
                            ...(savedBlock.params ? { params: savedBlock.params } : {})
                        });
                    });

                    useBlockStore.setState(state => ({
                        blocks: [...state.blocks, ...recreatedBlocks]
                    }));

                    // Restore the shell's wires into the single wire system so they
                    // both render (WireRenderer) and feed personas (aggregateWireContext).
                    // Legacy shells saved BlockConnection[]; convert on the way in.
                    const savedWires = shell.wires ?? legacyConnectionsToWires(shell.connections, shellId);
                    useWireStore.getState().replaceWiresForShell(shellId, savedWires);
                }

                blockStore.setActiveShell(shellId);

                // Update shell store metadata
                set(state => ({
                    shells: state.shells.map(s =>
                        s.id === shellId ? { ...s, lastAccessedAt: Date.now() } : s
                    ),
                    activeShellId: shellId,
                    currentPersona: shell.persona,
                    currentAesthetic: shell.aesthetic
                }));

                return true;
            },

            duplicateShell: (sourceShellId, name) => {
                const source = get().shells.find(s => s.id === sourceShellId);
                if (!source) return null;

                const newShellId = `shell_${newId()}`;
                const now = Date.now();

                const newShell: ShellConfig = {
                    ...source,
                    id: newShellId,
                    name: name || `${source.name} (Copy)`,
                    type: 'custom',
                    isTemplate: false,
                    hotkeySlot: undefined,
                    // Fresh wire ids + ownership so the copy's wires can't collide
                    // with the source shell's when both are loaded.
                    wires: (source.wires ?? legacyConnectionsToWires(source.connections, newShellId))
                        .map(w => ({
                            ...w,
                            id: `wire_${newId()}`,
                            shellId: newShellId
                        })),
                    connections: undefined,
                    createdAt: now,
                    updatedAt: now,
                    lastAccessedAt: now
                };

                set(state => ({
                    shells: [...state.shells, newShell]
                }));

                return newShell;
            },

            instantiateTemplate: (template, name) => {
                const now = Date.now();
                const newShellId = `shell_${newId()}`;

                // Remap each template block's local `ref` to a fresh unique instance id.
                const refToInstanceId = new Map<string, string>();
                const blocks = template.blocks.map(tb => {
                    const instanceId = `${tb.blockId}_${newId()}`;
                    refToInstanceId.set(tb.ref, instanceId);
                    const isPersona = tb.blockId.startsWith('persona_');
                    return {
                        blockId: tb.blockId,
                        instanceId,
                        position: tb.position,
                        dimensions: tb.dimensions ?? { width: 320, height: isPersona ? 400 : 240 },
                        ...(tb.params ? { params: tb.params } : {})
                    };
                });

                // Remap ref-based template connections to real DataWires (the single
                // wire system) so they render AND feed personas. Drop any that
                // reference a missing block (defensive — validateTemplate covers this).
                const wires: DataWire[] = template.connections
                    .map((c): DataWire | null => {
                        const sourceBlockId = refToInstanceId.get(c.sourceRef);
                        const targetBlockId = refToInstanceId.get(c.targetRef);
                        if (!sourceBlockId || !targetBlockId) return null;
                        return {
                            id: `wire_${newId()}`,
                            sourceBlockId,
                            targetBlockId,
                            wireType: 'push' as const,
                            filters: { ...DEFAULT_WIRE_FILTERS },
                            status: 'active' as const,
                            shellId: newShellId
                        };
                    })
                    .filter((w): w is DataWire => w !== null);

                const shellConfig: ShellConfig = {
                    id: newShellId,
                    type: 'custom',
                    name: name || template.name,
                    description: template.description,
                    blocks,
                    wires,
                    persona: template.persona,
                    aesthetic: template.aesthetic,
                    isTemplate: false,
                    templateTags: template.tags,
                    createdAt: now,
                    updatedAt: now,
                    lastAccessedAt: now
                };

                // Register the new shell, then reuse loadShell's tested block-recreation
                // path to populate + activate the canvas.
                set(state => ({ shells: [...state.shells, shellConfig] }));
                const ok = get().loadShell(newShellId);
                return ok ? newShellId : null;
            },

            assignHotkey: (shellId, slot) => {
                if (slot < 1 || slot > 9) return false;

                set(state => ({
                    hotkeySlots: { ...state.hotkeySlots, [slot]: shellId },
                    shells: state.shells.map(s =>
                        s.id === shellId ? { ...s, hotkeySlot: slot } : s
                    )
                }));

                return true;
            }
        }),
        {
            name: 'omni-shells',
            version: 1,
            // OmniVault (IndexedDB): shells carry block-data snapshots (A2).
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({
                shells: state.shells,
                activeShellId: state.activeShellId,
                hotkeySlots: state.hotkeySlots,
                currentPersona: state.currentPersona,
                currentAesthetic: state.currentAesthetic
            }),
            // v0 → v1 (A1 wire unification): shells saved before A1 carry legacy
            // BlockConnection[] in `connections`; convert to DataWires once.
            migrate: (persistedState: unknown) => {
                const persisted = (persistedState || {}) as { shells?: ShellConfig[] } & Record<string, unknown>;
                if (Array.isArray(persisted.shells)) {
                    persisted.shells = persisted.shells.map(shell => {
                        if (shell.wires || !shell.connections) {
                            return { ...shell, wires: shell.wires ?? [], connections: undefined };
                        }
                        return {
                            ...shell,
                            wires: legacyConnectionsToWires(shell.connections, shell.id),
                            connections: undefined
                        };
                    });
                }
                return persisted;
            },
            // A shell that is not a ShellConfig is dropped whole; a malformed
            // block or wire inside a shell is dropped alone, the shell stays.
            merge: (persistedState, currentState) => {
                if (!persistedState) return currentState;
                const persisted = persistedState as Record<string, unknown>;
                const shells = admitRecords<ShellConfig>('omni-shells', 'shells', persisted.shells, SHELL_CONFIG_SHAPE)
                    .map(shell => ({
                        ...shell,
                        blocks: admitRecords<ShellBlockState>('omni-shells', `${shell.id}.blocks`, shell.blocks, SHELL_BLOCK_SHAPE),
                        wires: admitRecords<DataWire>('omni-shells', `${shell.id}.wires`, shell.wires, DATA_WIRE_SHAPE)
                    }));
                const activeShellId = admitField<string | null>('omni-shells', persisted, 'activeShellId', 'string|null');
                return {
                    ...currentState,
                    shells,
                    activeShellId: activeShellId === undefined ? currentState.activeShellId : activeShellId,
                    hotkeySlots: admitField<Record<number, string>>('omni-shells', persisted, 'hotkeySlots', 'object')
                        ?? currentState.hotkeySlots,
                    currentPersona: admitField<PersonaType>('omni-shells', persisted, 'currentPersona', 'string')
                        ?? currentState.currentPersona,
                    currentAesthetic: admitField<AestheticTheme>('omni-shells', persisted, 'currentAesthetic', 'string')
                        ?? currentState.currentAesthetic
                };
            }
        }
    )
);
