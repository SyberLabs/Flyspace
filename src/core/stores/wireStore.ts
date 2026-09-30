// ============================================
// PROJECT OMNI: WIRE STORE
// Manages data connections between blocks
// ============================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DataWire, WireFilters, DEFAULT_WIRE_FILTERS } from '../schemas/wire.schema';
import { evaluateWireAdmission } from '../interaction/ports';
// Direct, not via the barrel. blockStore and wireStore are genuinely mutual —
// deleting a block clears its wires, and a new wire defaults to the active
// shell — but every use is a lazy .getState() inside a function body, so the
// cycle never resolves at module-init.
import { useBlockStore } from './blockStore';
import { admitConnection } from '../capabilities/compatibility';
import { vaultStorage } from '../vault';

interface WireStoreState {
    /** All wires in the system */
    wires: DataWire[];

    /** Why the last addWire call was refused. Null after a successful add. */
    lastAdmissionRefusal: string | null;

    /** Add a new wire connection */
    addWire: (sourceBlockId: string, targetBlockId: string, filters?: Partial<WireFilters>, shellId?: string) => string;

    /** Remove a wire */
    removeWire: (wireId: string) => void;

    /** Remove all wires connected to a block */
    removeWiresForBlock: (blockId: string) => void;

    /** Remove all wires belonging to a shell */
    removeWiresByShell: (shellId: string) => void;

    /** Replace a shell's wires wholesale (shell load/restore) */
    replaceWiresForShell: (shellId: string, wires: DataWire[]) => void;

    /** Get wires where block is source */
    getWiresFromBlock: (blockId: string) => DataWire[];

    /** Get wires where block is target (persona) */
    getWiresToBlock: (blockId: string) => DataWire[];

    /** Check if wire exists between two blocks */
    wireExists: (sourceBlockId: string, targetBlockId: string) => boolean;

    /** Get a specific wire */
    getWire: (wireId: string) => DataWire | undefined;

    /** Get all wires for a specific shell */
    getWiresByShell: (shellId: string) => DataWire[];
}

export const useWireStore = create<WireStoreState>()(
    persist(
        (set, get) => ({
            wires: [],
            lastAdmissionRefusal: null,

            addWire: (sourceBlockId, targetBlockId, filters, shellId) => {
                const blocks = useBlockStore.getState();
                const typed = evaluateWireAdmission(
                    blocks.getBlock(sourceBlockId),
                    blocks.getBlock(targetBlockId)
                );
                const admission = admitConnection(sourceBlockId, targetBlockId);
                if (!admission.ok) {
                    set({ lastAdmissionRefusal: admission.reason });
                    return '';
                }
                // A string sink may project across declared data types. An identity
                // wire may not.
                if (!typed.ok && admission.projection.kind === 'identity') {
                    set({ lastAdmissionRefusal: typed.reason });
                    return '';
                }

                // Don't create duplicate wires
                if (get().wireExists(sourceBlockId, targetBlockId)) {
                    const existing = get().wires.find(
                        w => w.sourceBlockId === sourceBlockId && w.targetBlockId === targetBlockId
                    );
                    return existing?.id || '';
                }

                const wireId = `wire_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const newWire: DataWire = {
                    id: wireId,
                    sourceBlockId,
                    targetBlockId,
                    ...(admission.sourcePortId ? { sourcePortId: admission.sourcePortId } : {}),
                    ...(admission.targetPortId ? { targetPortId: admission.targetPortId } : {}),
                    projection: admission.projection,
                    wireType: 'push', // Default: auto-send on source update
                    filters: { ...DEFAULT_WIRE_FILTERS, ...filters },
                    status: 'active',
                    shellId: shellId || useBlockStore.getState().activeShellId
                };

                set(state => ({
                    wires: [...state.wires, newWire],
                    lastAdmissionRefusal: null
                }));

                return wireId;
            },

            removeWire: (wireId) => {
                set(state => ({
                    wires: state.wires.filter(w => w.id !== wireId)
                }));
            },

            removeWiresForBlock: (blockId) => {
                set(state => ({
                    wires: state.wires.filter(
                        w => w.sourceBlockId !== blockId && w.targetBlockId !== blockId
                    )
                }));
            },

            removeWiresByShell: (shellId) => {
                set(state => ({
                    wires: state.wires.filter(w => w.shellId !== shellId)
                }));
            },

            replaceWiresForShell: (shellId, wires) => {
                const admitted = wires.flatMap(wire => {
                    const admission = admitConnection(wire.sourceBlockId, wire.targetBlockId);
                    if (!admission.ok) return [];
                    return [{
                        ...wire,
                        shellId,
                        ...(admission.sourcePortId ? { sourcePortId: admission.sourcePortId } : {}),
                        ...(admission.targetPortId ? { targetPortId: admission.targetPortId } : {}),
                        projection: admission.projection
                    }];
                });
                set(state => ({
                    wires: [
                        ...state.wires.filter(w => w.shellId !== shellId),
                        ...admitted
                    ]
                }));
            },

            getWiresFromBlock: (blockId) => {
                return get().wires.filter(w => w.sourceBlockId === blockId);
            },

            getWiresToBlock: (blockId) => {
                return get().wires.filter(w => w.targetBlockId === blockId);
            },

            wireExists: (sourceBlockId, targetBlockId) => {
                return get().wires.some(
                    w => w.sourceBlockId === sourceBlockId && w.targetBlockId === targetBlockId
                );
            },

            getWire: (wireId) => {
                return get().wires.find(w => w.id === wireId);
            },

            getWiresByShell: (shellId) => {
                return get().wires.filter(w => w.shellId === shellId);
            }
        }),
        {
            name: 'omni-wires',
            version: 2,
            // OmniVault (IndexedDB): wires are core canvas state (A2).
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({
                wires: state.wires
            }),
            migrate: (persistedState: unknown, _version: number) => {
                const persisted = (persistedState || {}) as { wires?: unknown };
                const wires = Array.isArray(persisted.wires) ? persisted.wires : [];

                // Migration from version 0/1 to version 2
                // Ensure all wires have shellId and wireType
                return {
                    wires: wires.map((wire: unknown) => {
                        const rec = (typeof wire === 'object' && wire !== null)
                            ? wire as DataWire
                            : {} as DataWire;
                        return {
                            ...rec,
                            shellId: rec.shellId || 'root',
                            wireType: rec.wireType || 'push'
                        };
                    })
                };
            }
        }
    )
);
