// ============================================
// PROJECT OMNI: SHELL CONFIGURATION SCHEMA
// ============================================

import { BlockConnection } from './block.schema';
import { DataWire } from './wire.schema';

/**
 * AI Persona types for different cognitive modes
 */
export type PersonaType =
    // Original personas
    | 'quant'       // Risk/EV analysis
    | 'muse'        // Creative synthesis
    | 'analyst'     // Causal reasoning / Data-driven insights
    // Persona block types
    | 'strategist'  // Long-term planning and tactical decisions
    | 'researcher'  // Deep investigation and knowledge synthesis
    | 'creative'    // Ideation and unconventional thinking
    | 'guardian';   // Risk assessment and protective analysis

/**
 * Visual aesthetic themes
 */
export type AestheticTheme =
    | 'command'     // High-density tactical
    | 'journal'     // Renaissance/warm
    | 'cybernetic'  // Map/network view
    | 'minimal'     // Clean/sparse
    | 'custom';     // User-defined via SKIN

/**
 * Shell types for universal shell architecture
 */
export type ShellType =
    | 'root'        // Default home shell
    | 'system'      // One of the 7 life system shells
    | 'custom'      // User-created shell
    | 'template';   // Reusable template

/**
 * Shell configuration - a saved Canvas state
 */
export interface ShellConfig {
    /** Unique shell identifier */
    id: string;

    /** Shell type for categorization */
    type: ShellType;

    /** Human-readable shell name */
    name: string;

    /** Description of the shell's purpose */
    description?: string;

    /** For system shells: which life system (health, career, etc.) */
    systemType?: string;

    /** Active blocks with their positions */
    blocks: ShellBlockState[];

    /** Wires between blocks (the single wire system: wireStore / DataWire) */
    wires: DataWire[];

    /**
     * @deprecated Legacy dual-wire-system field. Old persisted shells carry
     * BlockConnection[] here; converted to `wires` on load/migration (A1).
     */
    connections?: BlockConnection[];

    /** Active AI persona */
    persona: PersonaType;

    /** Visual aesthetic */
    aesthetic: AestheticTheme;

    /** Custom CSS overrides (from SKIN) */
    customCss?: string;

    /** Hotkey slot (1-9) for quick access */
    hotkeySlot?: number;

    /** Template metadata */
    isTemplate?: boolean;
    templateTags?: string[];

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
