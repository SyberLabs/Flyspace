// ============================================
// PROJECT OMNI: WIRE SCHEMA
// Data connections between blocks
// ============================================

import { PersonaType } from './shell.schema';

/**
 * Wire filter configuration
 */
export interface WireFilters {
    /** Only send summarized data */
    summaryOnly?: boolean;

    /** Time window for data */
    timeWindow?: 'hour' | 'day' | 'week' | 'all';

    /** Auto-refresh when source updates */
    autoRefresh: boolean;

    /** Specific fields to include (empty = all) */
    fields?: string[];
}

/**
 * Wire connection status
 */
export type WireStatus = 'active' | 'stale' | 'error' | 'disconnected';

/**
 * Wire type - defines data flow semantics
 */
export type WireType =
    | 'push'       // Auto-send when source updates (default)
    | 'pull'       // Target requests data on-demand
    | 'contextual' // Feed into AI context window (for personas)
    | 'reactive';  // Trigger computation on change

/**
 * A wire connecting a data block to a persona block
 */
export interface DataWire {
    /** Unique wire ID */
    id: string;

    /** Source block (data provider) */
    sourceBlockId: string;

    /** Target block (persona receiver) */
    targetBlockId: string;

    /** Wire type for data flow semantics */
    wireType: WireType;

    /** Wire configuration */
    filters: WireFilters;

    /** Current status */
    status: WireStatus;

    /** Last data transfer timestamp */
    lastTransfer?: number;

    /** Error message if status is 'error' */
    errorMessage?: string;

    /** Shell isolation - ID of the shell this wire belongs to */
    shellId: string;

}

/**
 * Where one section of a persona's context came from.
 *
 * Every kind is a wired block the user can point at and cut. They are
 * distinguished because they are different kinds of evidence:
 *   `wire`      live external data
 *   `memory`    recollection the user authored or accepted
 *   `inference` another persona's conclusion — a model's opinion, not a
 *               measurement. Worth flagging on its own: chaining minds
 *               compounds their errors, and the reader should see when an
 *               answer rests on another answer.
 */
export type ContextSourceKind = 'wire' | 'memory' | 'inference';

export interface ContextSource {
    /** Block instance id for `wire`; pool id for `ambient`. */
    id: string;
    kind: ContextSourceKind;
    /** Short human label for the provenance chip. */
    label: string;
    /**
     * For `kind: 'inference'` — one persona feeding another — the inference
     * ledger row id of the ANSWER that was consumed, not the block that holds
     * it. This is what lets the server walk a cascade's full lineage instead
     * of stopping at "some persona said something". Absent without Postgres,
     * or when the upstream answer predates the ledger.
     */
    parentRunId?: string;
}

/**
 * Chat message in a persona block
 */
export interface PersonaChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    /** Block IDs whose data informed this response. Legacy; see `sources`. */
    sourcedFrom?: string[];
    /**
     * Everything that actually fed this response, wired and ambient alike.
     * Recorded from the turn's own result, not from the block's wires —
     * a connected wire that carried no data is not a source.
     */
    sources?: ContextSource[];
    /** True when the user halted the stream. Partial content is kept. */
    stopped?: boolean;
    /**
     * Inference-ledger row id for the turn that produced this message. Carried
     * so a downstream persona consuming this answer can cite the run, not just
     * the block. Absent without Postgres.
     */
    runId?: string;
}

/**
 * Memory entry specific to a persona block
 */
export interface PersonaMemoryEntry {
    id: string;
    content: string;
    createdAt: number;
    importance: 'low' | 'medium' | 'high';
    /** Auto-generated or user-created */
    source: 'ai' | 'user' | 'crystallized';
}

/**
 * Data stored in a persona block
 */
export interface PersonaBlockData {
    /** Persona type determining behavior */
    personaType: PersonaType;

    /** Custom name for this persona instance */
    customName?: string;

    /** Conversation history */
    messages: PersonaChatMessage[];

    /** Per-persona memory pool (working memory) */
    memory: PersonaMemoryEntry[];

    /** Last context update timestamp */
    lastContextUpdate?: number;

    /** Aggregated context from wired blocks */
    currentContext?: string;

    /** Whether the block is collapsed */
    isCollapsed: boolean;

    /** Processing state */
    isThinking: boolean;

}

/**
 * Default wire filters
 */
export const DEFAULT_WIRE_FILTERS: WireFilters = {
    summaryOnly: false,
    timeWindow: 'all',
    autoRefresh: true,
    fields: []
};

/**
 * Default persona block data
 */
export function createPersonaBlockData(personaType: PersonaType): PersonaBlockData {
    return {
        personaType,
        messages: [],
        memory: [],
        isCollapsed: false,
        isThinking: false
    };
}

/**
 * Persona type configurations for visual display
 */
export const PERSONA_CONFIGS: Record<PersonaType, {
    name: string;
    avatar: string;
    color: string;
    description: string;
}> = {
    // Original personas (from Mind Panel)
    quant: {
        name: 'Quant',
        avatar: '📊',
        color: 'var(--truth-green)',
        description: 'Risk and expected value analysis'
    },
    muse: {
        name: 'Muse',
        avatar: '✨',
        color: 'var(--mind-solar-dawn)',
        description: 'Creative synthesis and inspiration'
    },
    sentinel: {
        name: 'Sentinel',
        avatar: '👁️',
        color: 'var(--truth-amber)',
        description: 'Monitoring and alert systems'
    },
    weaver: {
        name: 'Weaver',
        avatar: '🕸️',
        color: 'var(--citadel-accent)',
        description: 'Personalization and context weaving'
    },
    // Persona block types
    analyst: {
        name: 'Analyst',
        avatar: '🎯',
        color: 'var(--truth-green)',
        description: 'Data-driven insights and market analysis'
    },
    strategist: {
        name: 'Strategist',
        avatar: '⚔️',
        color: 'var(--truth-amber)',
        description: 'Long-term planning and tactical decisions'
    },
    researcher: {
        name: 'Researcher',
        avatar: '🔬',
        color: 'var(--citadel-primary)',
        description: 'Deep investigation and knowledge synthesis'
    },
    creative: {
        name: 'Creative',
        avatar: '🎨',
        color: 'var(--mind-aqua-surface)',
        description: 'Ideation and unconventional thinking'
    },
    guardian: {
        name: 'Guardian',
        avatar: '🛡️',
        color: 'var(--truth-red)',
        description: 'Risk assessment and protective analysis'
    }
};

