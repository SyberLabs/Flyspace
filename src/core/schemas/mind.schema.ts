// ============================================
// PROJECT OMNI: MIND SCHEMA DEFINITIONS
// The cognitive substrate of the Omni system
// ============================================

// ============================================
// LLM PROVIDER CONFIGURATION
// ============================================

/**
 * Supported LLM providers.
 *
 * Local (Ollama) runs offline with no key. Anthropic and Google are cloud
 * providers whose API keys live server-side (read from process.env by the
 * /api/llm route); keys are never stored client-side.
 */
export type LLMProvider = 'local' | 'anthropic' | 'google';

/**
 * LLM provider configuration.
 *
 * NOTE: intentionally contains NO apiKey. Cloud provider keys are held
 * server-side in environment variables and injected by the /api/llm route.
 */
export interface LLMConfig {
    provider: LLMProvider;
    model: string;
    baseUrl?: string;  // For local/custom endpoints (e.g. Ollama)
    temperature: number;
    maxTokens: number;
}

import { DEFAULT_MODEL } from '../models.registry';

/**
 * Default configurations for each provider.
 * Model ids come from the model registry (single source of truth — see
 * src/core/models.registry.ts, apex A5).
 */
export const LLM_DEFAULTS: Record<LLMProvider, LLMConfig> = {
    local: {
        provider: 'local',
        model: DEFAULT_MODEL.local,
        baseUrl: 'http://localhost:11434',  // Ollama default
        temperature: 0.7,
        maxTokens: 2048
    },
    anthropic: {
        provider: 'anthropic',
        model: DEFAULT_MODEL.anthropic,
        temperature: 0.7,
        maxTokens: 4096
    },
    google: {
        provider: 'google',
        model: DEFAULT_MODEL.google,
        temperature: 0.7,
        maxTokens: 4096
    }
};

// ============================================
// KNOWLEDGE GRAPH TYPES
// ============================================

/**
 * Node types in the knowledge graph
 */
export type KnowledgeNodeType = 'entity' | 'concept' | 'event' | 'insight' | 'prediction';

/**
 * A node in the knowledge graph
 */
export interface KnowledgeNode {
    id: string;
    type: KnowledgeNodeType;
    label: string;
    description?: string;
    properties: Record<string, unknown>;
    createdAt: number;
    updatedAt: number;
    sourceBlockId?: string;  // Block that created this node
    confidence: number;  // 0-1, how certain we are about this node
}

/**
 * Relationship types between nodes
 */
export type RelationType =
    | 'related_to'
    | 'causes'
    | 'correlates_with'
    | 'contradicts'
    | 'supports'
    | 'part_of'
    | 'precedes'
    | 'follows'
    | 'influences'
    | 'derived_from';

/**
 * An edge/relationship in the knowledge graph
 */
export interface KnowledgeEdge {
    id: string;
    sourceId: string;
    targetId: string;
    relation: RelationType;
    weight: number;  // Relationship strength 0-1
    bidirectional: boolean;
    metadata?: Record<string, unknown>;
    createdAt: number;
}

/**
 * Full knowledge graph structure
 */
export interface KnowledgeGraph {
    nodes: KnowledgeNode[];
    edges: KnowledgeEdge[];
    lastUpdated: number;
}

// ============================================
// PROGRAMMABLE PERSONAS
// ============================================

/**
 * Persona trait definition
 */
export interface PersonaTrait {
    id: string;
    name: string;
    description: string;
    value: number;  // 0-1 scale
}

/**
 * Built-in trait presets
 */
export const PERSONA_TRAITS: PersonaTrait[] = [
    { id: 'analytical', name: 'Analytical', description: 'Depth of logical analysis', value: 0.5 },
    { id: 'creative', name: 'Creative', description: 'Novelty in connections and ideas', value: 0.5 },
    { id: 'cautious', name: 'Cautious', description: 'Risk awareness and hedging', value: 0.5 },
    { id: 'decisive', name: 'Decisive', description: 'Speed and clarity of conclusions', value: 0.5 },
    { id: 'verbose', name: 'Verbose', description: 'Detail level in responses', value: 0.5 },
    { id: 'contrarian', name: 'Contrarian', description: 'Tendency to challenge consensus', value: 0.3 },
    { id: 'speculative', name: 'Speculative', description: 'Willingness to extrapolate', value: 0.5 },
    { id: 'empathetic', name: 'Empathetic', description: 'Consideration of human factors', value: 0.5 }
];

/**
 * Full persona configuration
 */
export interface PersonaConfig {
    id: string;
    name: string;
    description: string;
    avatar?: string;  // Emoji or image URL
    systemPrompt: string;
    traits: PersonaTrait[];
    isBuiltIn: boolean;
    createdAt: number;
    updatedAt: number;
}

/**
 * Built-in persona presets
 */
export const BUILTIN_PERSONAS: Omit<PersonaConfig, 'createdAt' | 'updatedAt'>[] = [
    {
        id: 'analyst',
        name: 'The Analyst',
        description: 'Deep analytical reasoning, finds patterns across data streams',
        avatar: '🔬',
        systemPrompt: `You are The Analyst, a rigorous analytical mind within the Omni system. 
Your purpose is to find patterns, correlations, and insights across data streams.
Be precise, cite evidence, and quantify uncertainty when possible.
When you identify connections between data points, explain your reasoning clearly.`,
        traits: [
            { ...PERSONA_TRAITS[0], value: 0.9 },  // Analytical: high
            { ...PERSONA_TRAITS[1], value: 0.3 },  // Creative: low
            { ...PERSONA_TRAITS[2], value: 0.7 },  // Cautious: high
            { ...PERSONA_TRAITS[3], value: 0.4 },  // Decisive: moderate
            { ...PERSONA_TRAITS[4], value: 0.6 },  // Verbose: moderate-high
            { ...PERSONA_TRAITS[5], value: 0.4 },  // Contrarian: moderate
            { ...PERSONA_TRAITS[6], value: 0.3 },  // Speculative: low
            { ...PERSONA_TRAITS[7], value: 0.3 }   // Empathetic: low
        ],
        isBuiltIn: true
    },
    {
        id: 'strategist',
        name: 'The Strategist',
        description: 'Forward-looking, connects dots to form actionable plans',
        avatar: '🎯',
        systemPrompt: `You are The Strategist, a forward-thinking mind within the Omni system.
Your purpose is to synthesize information into actionable strategies.
Consider multiple scenarios, weigh trade-offs, and propose clear next steps.
Think in terms of moves and counter-moves, risks and opportunities.`,
        traits: [
            { ...PERSONA_TRAITS[0], value: 0.7 },  // Analytical: high
            { ...PERSONA_TRAITS[1], value: 0.6 },  // Creative: moderate-high
            { ...PERSONA_TRAITS[2], value: 0.5 },  // Cautious: moderate
            { ...PERSONA_TRAITS[3], value: 0.8 },  // Decisive: high
            { ...PERSONA_TRAITS[4], value: 0.4 },  // Verbose: moderate-low
            { ...PERSONA_TRAITS[5], value: 0.5 },  // Contrarian: moderate
            { ...PERSONA_TRAITS[6], value: 0.7 },  // Speculative: high
            { ...PERSONA_TRAITS[7], value: 0.4 }   // Empathetic: moderate
        ],
        isBuiltIn: true
    },
    {
        id: 'oracle',
        name: 'The Oracle',
        description: 'Synthesizes broad context into probabilistic predictions',
        avatar: '🔮',
        systemPrompt: `You are The Oracle, the predictive mind within the Omni system.
Your purpose is to synthesize available data into probabilistic forecasts.
Always express predictions with confidence levels and identify key assumptions.
Be clear about what could invalidate your predictions.`,
        traits: [
            { ...PERSONA_TRAITS[0], value: 0.6 },  // Analytical: moderate-high
            { ...PERSONA_TRAITS[1], value: 0.7 },  // Creative: high
            { ...PERSONA_TRAITS[2], value: 0.6 },  // Cautious: moderate-high
            { ...PERSONA_TRAITS[3], value: 0.5 },  // Decisive: moderate
            { ...PERSONA_TRAITS[4], value: 0.5 },  // Verbose: moderate
            { ...PERSONA_TRAITS[5], value: 0.6 },  // Contrarian: moderate-high
            { ...PERSONA_TRAITS[6], value: 0.9 },  // Speculative: very high
            { ...PERSONA_TRAITS[7], value: 0.5 }   // Empathetic: moderate
        ],
        isBuiltIn: true
    },
    {
        id: 'devil',
        name: "Devil's Advocate",
        description: 'Challenges assumptions, stress-tests ideas',
        avatar: '😈',
        systemPrompt: `You are the Devil's Advocate within the Omni system.
Your purpose is to challenge assumptions, find weaknesses, and stress-test ideas.
Be respectfully contrarian. For every thesis, find the anti-thesis.
Identify blind spots, hidden risks, and uncomfortable questions others avoid.`,
        traits: [
            { ...PERSONA_TRAITS[0], value: 0.7 },  // Analytical: high
            { ...PERSONA_TRAITS[1], value: 0.5 },  // Creative: moderate
            { ...PERSONA_TRAITS[2], value: 0.8 },  // Cautious: high
            { ...PERSONA_TRAITS[3], value: 0.3 },  // Decisive: low (questions more)
            { ...PERSONA_TRAITS[4], value: 0.5 },  // Verbose: moderate
            { ...PERSONA_TRAITS[5], value: 0.95 }, // Contrarian: very high
            { ...PERSONA_TRAITS[6], value: 0.4 },  // Speculative: moderate
            { ...PERSONA_TRAITS[7], value: 0.2 }   // Empathetic: low
        ],
        isBuiltIn: true
    }
];

// ============================================
// CONTEXT POOLS
// ============================================

/**
 * Entry types in a context pool
 */
export type ContextEntryType =
    | 'observation'      // Raw data from blocks
    | 'inference'        // AI-generated insights
    | 'directive'        // User instructions
    | 'prediction'       // Forward-looking statements
    | 'question'         // Unresolved questions
    | 'memory'           // Long-term memories
    | 'warning'          // Risk alerts and cautions
    | 'analysis';        // Full analysis from Mind

/**
 * A single entry in a context pool
 */
export interface ContextEntry {
    id: string;
    type: ContextEntryType;
    content: string;
    importance: number;  // 0-1, affects pruning
    timestamp: number;
    sourceBlockId?: string;
    metadata?: Record<string, unknown>;
}

// ============================================
// MEMORY BLOCK
// A Mind pool as an object on the canvas. Before this existed, pools reached
// personas through hidden per-persona toggles: real context with no spatial
// representation, which the product's own thesis forbids. Now a pool is wired
// in like any other source — visible, inspectable, and cuttable.
// ============================================

export interface MemoryBlockData {
    /** Which Mind pool this block surfaces. */
    poolId: string;
    /** Snapshot of the pool, synced by the view so wires carry it. */
    entries: ContextEntry[];
    /** Cap on how many of the most recent entries are wired downstream. */
    limit: number;
}

export function createMemoryBlockData(poolId: string = 'memory'): MemoryBlockData {
    return { poolId, entries: [], limit: 10 };
}

/**
 * Pruning strategies for context pools
 */
export type PruneStrategy = 'fifo' | 'importance' | 'recency' | 'hybrid';

/**
 * A context pool configuration
 */
export interface ContextPool {
    id: string;
    name: string;
    description: string;
    icon?: string;
    entries: ContextEntry[];
    maxEntries: number;
    pruneStrategy: PruneStrategy;
    isSystem: boolean;  // Built-in vs user-created
    createdAt: number;
    updatedAt: number;
}

/**
 * Built-in context pool definitions
 */
export const BUILTIN_POOLS: Omit<ContextPool, 'entries' | 'createdAt' | 'updatedAt'>[] = [
    {
        id: 'observations',
        name: 'Observations',
        description: 'Shell Mind auto-awareness of all active blocks. Short-term memory tier.',
        icon: '👁️',
        maxEntries: 100,
        pruneStrategy: 'recency',
        isSystem: true
    },
    {
        id: 'focus',
        name: 'Focused Blocks',
        description: 'User attention signal - pinned blocks for deep analysis (max 5). Can be imported by Persona Blocks.',
        icon: '📍',
        maxEntries: 5,
        pruneStrategy: 'importance',
        isSystem: true
    },
    {
        id: 'inferences',
        name: 'Inferences',
        description: 'Shell Mind insights and pattern detections. Short-term memory tier.',
        icon: '💡',
        maxEntries: 50,
        pruneStrategy: 'importance',
        isSystem: true
    },
    {
        id: 'directives',
        name: 'Directives',
        description: 'User instructions and strategic goals. Short-term memory tier.',
        icon: '🎯',
        maxEntries: 20,
        pruneStrategy: 'fifo',
        isSystem: true
    },
    {
        id: 'predictions',
        name: 'Predictions',
        description: 'Shell Mind forecasts and scenarios. Short-term memory tier.',
        icon: '🔮',
        maxEntries: 30,
        pruneStrategy: 'hybrid',
        isSystem: true
    },
    {
        id: 'memory',
        name: 'Long-term Memory',
        description: 'Crystallized insights persisted across sessions. Long-term memory tier.',
        icon: '🧠',
        maxEntries: 200,
        pruneStrategy: 'importance',
        isSystem: true
    }
];

// ============================================
// MIND STATE
// ============================================

/**
 * Mind connection status
 */
export type MindStatus = 'offline' | 'initializing' | 'ready' | 'processing' | 'error';

/**
 * Full Mind state structure
 */
export interface MindState {
    status: MindStatus;
    llmConfig: LLMConfig;
    graph: KnowledgeGraph;
    personas: PersonaConfig[];
    activePersonaId: string;
    contextPools: ContextPool[];
    lastError?: string;
}

/**
 * Default initial Mind state
 */
export function createInitialMindState(): MindState {
    const now = Date.now();

    return {
        status: 'offline',
        llmConfig: { ...LLM_DEFAULTS.local },
        graph: {
            nodes: [],
            edges: [],
            lastUpdated: now
        },
        personas: BUILTIN_PERSONAS.map(p => ({
            ...p,
            createdAt: now,
            updatedAt: now
        })),
        activePersonaId: 'analyst',
        contextPools: BUILTIN_POOLS.map(p => ({
            ...p,
            entries: [],
            createdAt: now,
            updatedAt: now
        })),
        lastError: undefined
    };
}
