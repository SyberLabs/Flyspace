// ============================================
// PROJECT OMNI: UI STORE
// Ephemeral view state — deliberately not persisted. Drag state and a
// highlight channel should not survive a reload.
// ============================================

import { create } from 'zustand';

// ============================================
// UI STORE (for command palette, modals, etc.)
// ============================================

interface UIState {
    /** Command palette open state */
    commandPaletteOpen: boolean;

    /** Currently dragging block type (for DnD from Armory) */
    draggingBlockId: string | null;

    /** Selected block instance ID */
    selectedBlockId: string | null;

    /** Open command palette */
    openCommandPalette: () => void;

    /** Close command palette */
    closeCommandPalette: () => void;

    /** Toggle command palette */
    toggleCommandPalette: () => void;

    /** Set dragging block */
    setDraggingBlock: (blockId: string | null) => void;

    /** Set selected block */
    setSelectedBlock: (instanceId: string | null) => void;

    /**
     * Blocks to highlight on the canvas. Set while hovering a provenance
     * chip on a persona answer, so 'what fed this' is answerable by
     * pointing rather than by reading ids.
     */
    highlightedBlockIds: string[];
    setHighlightedBlocks: (ids: string[]) => void;
}

export const useUIStore = create<UIState>()((set) => ({
    commandPaletteOpen: false,
    draggingBlockId: null,
    selectedBlockId: null,
    highlightedBlockIds: [],

    openCommandPalette: () => set({ commandPaletteOpen: true }),
    closeCommandPalette: () => set({ commandPaletteOpen: false }),
    toggleCommandPalette: () => set(state => ({ commandPaletteOpen: !state.commandPaletteOpen })),
    setDraggingBlock: (blockId) => set({ draggingBlockId: blockId }),
    setSelectedBlock: (instanceId) => set({ selectedBlockId: instanceId }),
    setHighlightedBlocks: (ids) => set({ highlightedBlockIds: ids })
}));
