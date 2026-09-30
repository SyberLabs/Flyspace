// Canvas mutation inventory (spec §15). Every file outside the stores that
// writes topology or geometry is listed here. A write is either routed through
// the InteractionEngine or named as an exception with its reason.
// mutationInventory.test.ts scans src and fails on anything unlisted.

/** Store actions that change which blocks, wires, or shells exist, or where blocks sit. */
export const TOPOLOGY_WRITES = [
    'addBlock',
    'removeBlock',
    'updatePosition',
    'updateDimensions',
    'clearCanvas',
    'setActiveShell',
    'clearShell',
    'addWire',
    'removeWire',
    'removeWiresForBlock',
    'removeWiresByShell',
    'replaceWiresForShell',
    'createWire',
    'createShell',
    'saveShell',
    'loadShell',
    'duplicateShell',
    'instantiateTemplate',
    'deleteShell',
    'setState'
] as const;

export type TopologyWrite = typeof TOPOLOGY_WRITES[number];

export interface InventoryException {
    write: TopologyWrite;
    /** The concrete function that makes the write. */
    in: string;
    reason: string;
}

export interface InventoryEntry {
    file: string;
    /** User actions in this file that now enter the engine. */
    routed: Array<{ action: string; via: 'pointerCreate' | 'pointerDelete' | 'pointerConnect' | 'pointerMove' }>;
    /** Direct writes that remain, each with a reason. Anything else in the file fails the scan. */
    exceptions: InventoryException[];
}

export const MUTATION_INVENTORY: InventoryEntry[] = [
    {
        file: 'src/canvas/Canvas.tsx',
        routed: [
            { action: 'sidebar drop places a block', via: 'pointerCreate' },
            { action: 'block close control removes a block', via: 'pointerDelete' },
            { action: 'drag release moves a block', via: 'pointerMove' },
            { action: 'west/north resize commits the new position', via: 'pointerMove' }
        ],
        exceptions: [
            { write: 'updateDimensions', in: 'DraggableBlock resize handleMouseMove', reason: 'size is presentational; no spatial command or speech verb resizes' },
            { write: 'updatePosition', in: 'DraggableBlock resize handleMouseMove/handleMouseUp', reason: 'live preview during a west/north resize; reset on release, then committed through pointerMove' }
        ]
    },
    {
        file: 'src/components/Sidebar.tsx',
        routed: [{ action: 'BlockItem handleClick quick-adds a block', via: 'pointerCreate' }],
        exceptions: []
    },
    {
        file: 'src/components/CommandPalette.tsx',
        routed: [{ action: 'handleAddBlock adds a block', via: 'pointerCreate' }],
        exceptions: [
            { write: 'clearCanvas', in: 'handleClearCanvas', reason: 'bulk clear is a host-only command; speech refuses bulk deletion by design' },
            { write: 'createShell', in: 'handleCreateShell', reason: 'shell persistence is owned by shellStore, not a canvas command' },
            { write: 'loadShell', in: 'handleLoadShell', reason: 'whole-canvas swap owned by shellStore; speech open-shell calls the same loadShell inside the engine' }
        ]
    },
    {
        file: 'src/canvas/WireHandle.tsx',
        routed: [{ action: 'wire drag from an output handle onto a block', via: 'pointerConnect' }],
        exceptions: []
    },
    {
        file: 'src/canvas/WireRenderer.tsx',
        routed: [],
        exceptions: [
            { write: 'removeWire', in: 'handleRemoveWire', reason: 'wire removal has no speech verb; the host confirm() dialog is the gate' }
        ]
    },
    {
        file: 'src/components/ShellPanel.tsx',
        routed: [],
        exceptions: [
            { write: 'createShell', in: 'handleCreateShell', reason: 'shell persistence, not canvas topology' },
            { write: 'saveShell', in: 'handleSaveCurrentShell', reason: 'shell persistence, not canvas topology' },
            { write: 'loadShell', in: 'handleLoadShell', reason: 'whole-canvas swap owned by shellStore' },
            { write: 'instantiateTemplate', in: 'handleUseTemplate', reason: 'template instantiation is a shellStore transaction' },
            { write: 'deleteShell', in: 'handleDeleteShell', reason: 'deletes a saved shell record behind a host confirm() dialog' },
            { write: 'duplicateShell', in: 'handleDuplicateShell', reason: 'shell persistence, not canvas topology' }
        ]
    },
    {
        file: 'src/core/hooks/useShellNavigation.ts',
        routed: [],
        exceptions: [
            { write: 'setActiveShell', in: 'useShellNavigation effect', reason: 'URL-driven navigation mirrors the route into the store; the user action is the browser navigation' }
        ]
    },
    {
        file: 'src/components/mind/ThinkResultModal.tsx',
        routed: [],
        exceptions: [
            { write: 'addBlock', in: 'handleCrystallize', reason: 'places an insight note with a custom schema and a content payload; the engine add takes a vocabulary type and no data, and no speech verb makes this note' }
        ]
    },
    {
        file: 'src/core/services/crystallize.service.ts',
        routed: [],
        exceptions: [
            { write: 'addBlock', in: 'crystallize', reason: 'writes the Mind pool and its memory block together; a separate authority from speech "remember this"' },
            { write: 'addWire', in: 'crystallize', reason: 'wires the memory block it just created, through wireStore admission' }
        ]
    },
    {
        file: 'src/core/services/wire.service.ts',
        routed: [],
        exceptions: [
            { write: 'createWire', in: 'WireService.createWire', reason: 'the wire admission service the engine calls; not a user action' },
            { write: 'addWire', in: 'WireService.createWire', reason: 'wireStore.addWire runs admitConnection' }
        ]
    },
    {
        file: 'src/core/capabilities/registry.ts',
        routed: [],
        exceptions: [
            { write: 'removeBlock', in: 'unbindRuntime', reason: 'uninstall removes the blocks of a capability that no longer exists; capability authority boundary' },
            { write: 'setState', in: 'commit', reason: 'swaps the schema on blocks of a reinstalled capability; capability authority boundary' }
        ]
    },
    {
        file: 'src/core/interaction/session.ts',
        routed: [],
        exceptions: [
            { write: 'updatePosition', in: 'createStoreMutator.move', reason: 'the engine CanvasMutator' },
            { write: 'addBlock', in: 'createStoreMutator.add', reason: 'the engine CanvasMutator' },
            { write: 'removeBlock', in: 'createStoreMutator.remove', reason: 'the engine CanvasMutator' },
            { write: 'setState', in: 'createStoreMutator.restore', reason: 'the engine CanvasMutator (undo of delete)' },
            { write: 'createWire', in: 'createStoreMutator.connect', reason: 'the engine CanvasMutator' },
            { write: 'removeWire', in: 'createStoreMutator.disconnect', reason: 'the engine CanvasMutator' },
            { write: 'setActiveShell', in: 'createStoreMutator.openShell', reason: 'the engine CanvasMutator' },
            { write: 'loadShell', in: 'createStoreMutator.openShell', reason: 'the engine CanvasMutator' },
            { write: 'instantiateTemplate', in: 'createStoreMutator.openShell', reason: 'the engine CanvasMutator' }
        ]
    }
];

/** Directories whose files are the stores themselves. */
export const STORE_ROOTS = ['src/core/stores/'];
