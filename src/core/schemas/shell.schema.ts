// ============================================
// PROJECT OMNI: SHELL CONFIGURATION SCHEMA
// ============================================

import { BlockConnection } from './block.schema';
import { DataWire } from './wire.schema';

/**
 * AI Persona types for different cognitive modes
 */
export type PersonaType =
    | 'analyst'     // Causal reasoning / Data-driven insights
    | 'strategist'  // Long-term planning and tactical decisions
    | 'researcher'  // Deep investigation and knowledge synthesis
    | 'creative'    // Ideation and unconventional thinking
    | 'guardian';   // Risk assessment and protective analysis

/**
 * Shell configuration - a saved Canvas state
 */
export interface ShellConfig {
    /** Unique shell identifier */
    id: string;

    /** Human-readable shell name */
    name: string;

    /** Description of the shell's purpose */
    description?: string;

    /** Active blocks with their positions */
    blocks: ShellBlockState[];

    /** Wires between blocks (the single wire system: wireStore / DataWire) */
    wires: DataWire[];

    /**
     * @deprecated Legacy dual-wire-system field. Old persisted shells carry
     * BlockConnection[] here; converted to `wires` on load/migration (A1).
     */
    connections?: BlockConnection[];

    /** Creation timestamp */
    createdAt: number;

    /** Last modified timestamp */
    updatedAt: number;

    /** Last accessed timestamp */
    lastAccessedAt?: number;
}

/**
 * Block state within a shell (lighter than full BlockInstance)
 */
export interface ShellBlockState {
    /** Reference to block schema ID */
    blockId: string;

    /** Instance ID for this placement */
    instanceId: string;

    /** Canvas position */
    position: { x: number; y: number };

    /** Canvas dimensions */
    dimensions: { width: number; height: number };

    /** Fetch/config knobs copied from BlockInstance.params */
    params?: Record<string, unknown>;

    /** Block-specific configuration */
    config?: Record<string, unknown>;
}

/**
 * Global application settings
 */
export interface OmniSettings {
    /** Use mock data for APIs */
    useMockData: boolean;

    /** Canvas grid snapping enabled */
    gridSnapping: boolean;

    /** Grid size in pixels */
    gridSize: number;
}
