// ============================================
// PROJECT OMNI: TOOL STORE
// Global state for Shell/Canvas tools
// ============================================

import { create } from 'zustand';

// ============================================
// TYPES
// ============================================

export type ToolType = 'navigate' | 'highlighter';

export interface SelectionData {
    text: string;
    sourceBlockId?: string;
    sourceBlockType?: string;
}

interface ToolState {
    activeTool: ToolType;
    selection: SelectionData | null;
}

interface ToolActions {
    setTool: (tool: ToolType) => void;
    captureSelection: (data: SelectionData) => void;
    clearSelection: () => void;
}

type ToolStore = ToolState & ToolActions;

// ============================================
// STORE
// ============================================

export const useToolStore = create<ToolStore>((set) => ({
    // Initial State
    activeTool: 'navigate',
    selection: null,

    // Actions
    setTool: (tool) => set({ activeTool: tool }),

    captureSelection: (data) => set({ selection: data }),

    clearSelection: () => set({ selection: null }),
}));
