// ============================================
// PROJECT OMNI: MIND STORE
// Zustand store for the cognitive substrate
// ============================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
    MindState,
    MindStatus,
    LLMConfig,
    LLMProvider,
    LLM_DEFAULTS,
    PersonaConfig,
    ContextEntry,
    ContextPool,
    KnowledgeGraph,
    createInitialMindState
} from '../schemas/mind.schema';
import { resolveModel } from '../models.registry';
import { vaultStorage } from '../vault';
import { newId } from '../id';
import { admitField, admitRecords, type Shape } from '../vault/hydration';

// What each persisted record must carry to be read back (see vault/hydration).
const LLM_CONFIG_SHAPE = {
    provider: 'string',
    model: 'string',
    temperature: 'number',
    maxTokens: 'number'
} as const satisfies Shape<LLMConfig>;

const GRAPH_SHAPE = {
    nodes: 'array',
    edges: 'array',
    lastUpdated: 'number'
} as const satisfies Shape<KnowledgeGraph>;

const PERSONA_SHAPE = {
    id: 'string',
    name: 'string',
    description: 'string',
    systemPrompt: 'string',
    traits: 'array',
    isBuiltIn: 'boolean',
    createdAt: 'number',
    updatedAt: 'number'
} as const satisfies Shape<PersonaConfig>;

const CONTEXT_POOL_SHAPE = {
    id: 'string',
    name: 'string',
    description: 'string',
    entries: 'array',
    maxEntries: 'number',
    pruneStrategy: 'string',
    isSystem: 'boolean',
    createdAt: 'number',
    updatedAt: 'number'
} as const satisfies Shape<ContextPool>;

const CONTEXT_ENTRY_SHAPE = {
    id: 'string',
    type: 'string',
    content: 'string',
    importance: 'number',
    timestamp: 'number'
} as const satisfies Shape<ContextEntry>;

// ============================================
// STORE INTERFACE
// ============================================

interface MindStore extends MindState {
    // ==================
    // Status Management
    // ==================
    setStatus: (status: MindStatus, error?: string) => void;
    initialize: () => Promise<void>;

    // ==================
    // LLM Configuration
    // ==================
    setProvider: (provider: LLMProvider) => void;

    // ==================
    // Personas
    // ==================
    setActivePersona: (personaId: string) => void;
    getActivePersona: () => PersonaConfig | undefined;

    // ==================
    // Context Pools
    // ==================
    pushContext: (poolId: string, entry: Omit<ContextEntry, 'id' | 'timestamp'>) => string;
    addToPool: (poolId: string, entry: Omit<ContextEntry, 'id' | 'timestamp'>) => string; // Alias for pushContext
    getPoolEntries: (poolId: string) => ContextEntry[];
    clearPool: (poolId: string) => void;

    // ==================
    // Focus Management
    // ==================
    pinBlock: (blockId: string, blockType: string, data: unknown) => boolean;
    unpinBlock: (blockId: string) => void;
    isPinned: (blockId: string) => boolean;
    clearFocus: () => void;
    saveToMemory: (blockId: string, blockType: string, data: unknown) => void;
    clearEphemeralContext: () => void;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function generateId(prefix: string): string {
    return `${prefix}_${newId()}`;
}

/**
 * Prune entries based on strategy
 */
function pruneEntries(
    entries: ContextEntry[],
    maxEntries: number,
    strategy: 'fifo' | 'importance' | 'recency' | 'hybrid'
): ContextEntry[] {
    if (entries.length <= maxEntries) return entries;

    const toRemove = entries.length - maxEntries;

    switch (strategy) {
        case 'fifo':
            // Remove oldest first
            return entries.slice(toRemove);

        case 'recency':
            // Sort by timestamp, keep most recent
            return [...entries]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, maxEntries);

        case 'importance':
            // Sort by importance, keep highest
            return [...entries]
                .sort((a, b) => b.importance - a.importance)
                .slice(0, maxEntries);

        case 'hybrid':
            // Combined score of recency and importance
            const now = Date.now();
            const maxAge = Math.max(...entries.map(e => now - e.timestamp));
            return [...entries]
                .sort((a, b) => {
                    const scoreA = a.importance * 0.6 + (1 - (now - a.timestamp) / maxAge) * 0.4;
                    const scoreB = b.importance * 0.6 + (1 - (now - b.timestamp) / maxAge) * 0.4;
                    return scoreB - scoreA;
                })
                .slice(0, maxEntries);

        default:
            return entries.slice(toRemove);
    }
}

// ============================================
// STORE IMPLEMENTATION
// ============================================

export const useMindStore = create<MindStore>()(
    persist(
        (set, get) => ({
            // Initial state
            ...createInitialMindState(),

            // ==================
            // Status Management
            // ==================
            setStatus: (status, error) => set({ status, lastError: error }),

            initialize: async () => {
                set({ status: 'initializing' });
                try {
                    // Clear focus pool on init to prevent stale data
                    set(state => ({
                        contextPools: state.contextPools.map(pool =>
                            pool.id === 'focus'
                                ? { ...pool, entries: [], updatedAt: Date.now() }
                                : pool
                        )
                    }));

                    // In the future, this could:
                    // - Load embeddings
                    // - Connect to local LLM
                    // - Restore graph from IndexedDB
                    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate init
                    set({ status: 'ready' });
                } catch (error) {
                    set({
                        status: 'error',
                        lastError: (error as Error).message
                    });
                }
            },

            // ==================
            // LLM Configuration
            // ==================
            setProvider: (provider) => {
                // Cloud provider keys live server-side (process.env); nothing
                // secret is stored here. Selecting a provider just swaps defaults.
                set({ llmConfig: { ...LLM_DEFAULTS[provider] } });
            },

            // ==================
            // Personas
            // ==================
            setActivePersona: (personaId) => set({ activePersonaId: personaId }),

            getActivePersona: () => {
                const state = get();
                return state.personas.find(p => p.id === state.activePersonaId);
            },

            // ==================
            // Context Pools
            // ==================
            pushContext: (poolId, entry) => {
                const id = generateId('ctx');
                const now = Date.now();
                const newEntry: ContextEntry = {
                    ...entry,
                    id,
                    timestamp: now
                };

                set(state => ({
                    contextPools: state.contextPools.map(pool => {
                        if (pool.id !== poolId) return pool;

                        // Add new entry
                        let entries = [...pool.entries, newEntry];

                        // Enforce 30-item limit for observations (FIFO)
                        if (poolId === 'observations' && entries.length > 30) {
                            entries = entries.slice(entries.length - 30);
                        } else {
                            // Use standard pruning for other pools
                            entries = pruneEntries(
                                entries,
                                pool.maxEntries,
                                pool.pruneStrategy
                            );
                        }

                        return {
                            ...pool,
                            entries,
                            updatedAt: now
                        };
                    })
                }));

                return id;
            },

            // Alias for pushContext - used by MindEngine
            addToPool: (poolId, entry) => get().pushContext(poolId, entry),

            getPoolEntries: (poolId) => {
                const pool = get().contextPools.find(p => p.id === poolId);
                return pool?.entries || [];
            },

            clearEphemeralContext: () => {
                const EPHEMERAL_POOLS = ['observations', 'predictions', 'directives', 'inferences'];
                set(state => ({
                    contextPools: state.contextPools.map(pool =>
                        EPHEMERAL_POOLS.includes(pool.id)
                            ? { ...pool, entries: [], updatedAt: Date.now() }
                            : pool
                    )
                }));
            },

            clearPool: (poolId) => {
                set(state => ({
                    contextPools: state.contextPools.map(pool =>
                        pool.id === poolId
                            ? { ...pool, entries: [], updatedAt: Date.now() }
                            : pool
                    )
                }));
            },

            // ==================
            // Focus Management
            // ==================
            pinBlock: (blockId, blockType, data) => {
                const { contextPools, pushContext, isPinned } = get();

                // Check if already pinned
                if (isPinned(blockId)) {
                    return false;
                }

                // Check focus pool limit
                const focusPool = contextPools.find(p => p.id === 'focus');
                if (focusPool && focusPool.entries.length >= 5) {
                    console.warn('Focus pool at max capacity (5 blocks)');
                    return false;
                }

                // Create full data entry for focus pool
                const fullContent = formatBlockDataForFocus(blockType, data);
                pushContext('focus', {
                    type: 'observation',
                    content: fullContent,
                    importance: 1.0, // High importance for focused blocks
                    sourceBlockId: blockId,
                    metadata: { blockType, pinnedAt: Date.now() }
                });

                return true;
            },

            unpinBlock: (blockId) => {
                set(state => ({
                    contextPools: state.contextPools.map(pool =>
                        pool.id === 'focus'
                            ? { ...pool, entries: pool.entries.filter(e => e.sourceBlockId !== blockId), updatedAt: Date.now() }
                            : pool
                    )
                }));
            },

            isPinned: (blockId) => {
                const focusPool = get().contextPools.find(p => p.id === 'focus');
                return focusPool?.entries.some(e => e.sourceBlockId === blockId) || false;
            },

            clearFocus: () => {
                set(state => ({
                    contextPools: state.contextPools.map(pool =>
                        pool.id === 'focus'
                            ? { ...pool, entries: [], updatedAt: Date.now() }
                            : pool
                    )
                }));
            },

            saveToMemory: (blockId, blockType, data) => {
                const { pushContext } = get();
                // Use detailed format for memory
                const content = formatBlockDataForFocus(blockType, data);

                pushContext('memory', {
                    type: 'memory',
                    content: `[Snapshot] ${content}`,
                    importance: 1.0,
                    sourceBlockId: blockId,
                    metadata: { blockType, savedAt: Date.now() }
                });
            }
        }),
        {
            name: 'omni-mind',
            // v1 is the first versioned blob. Nothing changed shape; the
            // version exists so the next change can migrate instead of cast.
            version: 1,
            // OmniVault (IndexedDB): context pools + graph grow over time (A2).
            storage: createJSONStorage(() => vaultStorage),
            partialize: (state) => ({
                llmConfig: state.llmConfig,
                graph: state.graph,
                personas: state.personas,
                activePersonaId: state.activePersonaId,
                contextPools: state.contextPools
            }),
            // v0 → v1: carried forward unchanged. Shape is merge's job.
            migrate: (persistedState: unknown) => persistedState,
            // Every persisted field is checked against its schema. A field or
            // record that does not fit is dropped and recorded, and the fresh
            // default stands in. Built-in pools the blob lacks are added.
            merge: (persistedState, currentState) => {
                if (!persistedState) return currentState;
                const persisted = persistedState as Record<string, unknown>;

                // Migrate persisted LLM config: drop any persisted apiKey (keys
                // are now server-side only) and reset removed providers
                // (openai/deepseek) to the default local provider.
                const validProviders: LLMProvider[] = ['local', 'anthropic', 'google'];
                const persistedLLM = admitField<LLMConfig & { apiKey?: string }>(
                    'omni-mind', persisted, 'llmConfig', LLM_CONFIG_SHAPE
                );
                let mergedLLM = currentState.llmConfig;
                if (persistedLLM) {
                    if (validProviders.includes(persistedLLM.provider)) {
                        const { apiKey: _drop, ...rest } = persistedLLM;
                        mergedLLM = { ...currentState.llmConfig, ...rest };
                    } else {
                        // Removed/unknown provider → fall back to local defaults
                        mergedLLM = { ...LLM_DEFAULTS.local };
                    }
                }

                // Repair stale/removed model names via the model registry so
                // existing users don't keep a deprecated id (→ live 404s).
                const healedModel = resolveModel(mergedLLM.provider, mergedLLM.model);
                if (healedModel !== mergedLLM.model) {
                    mergedLLM = { ...mergedLLM, model: healedModel };
                }

                const graph = admitField<KnowledgeGraph>('omni-mind', persisted, 'graph', GRAPH_SHAPE);
                const personas = persisted.personas === undefined
                    ? currentState.personas
                    : admitRecords<PersonaConfig>('omni-mind', 'personas', persisted.personas, PERSONA_SHAPE);
                const activePersonaId = admitField<string>('omni-mind', persisted, 'activePersonaId', 'string');

                // Ensure all built-in pools exist (handles schema migrations)
                const mergedPools = admitRecords<ContextPool>(
                    'omni-mind', 'contextPools', persisted.contextPools, CONTEXT_POOL_SHAPE
                ).map(pool => ({
                    ...pool,
                    entries: admitRecords<ContextEntry>('omni-mind', `${pool.id}.entries`, pool.entries, CONTEXT_ENTRY_SHAPE)
                }));
                for (const freshPool of currentState.contextPools) {
                    if (!mergedPools.find(p => p.id === freshPool.id)) {
                        mergedPools.push(freshPool);
                    }
                }

                return {
                    ...currentState,
                    llmConfig: mergedLLM,
                    graph: graph ?? currentState.graph,
                    personas,
                    activePersonaId: activePersonaId ?? currentState.activePersonaId,
                    contextPools: mergedPools
                };
            }
        }
    )
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Format full block data for focus pool (deep analysis)
 */
function formatBlockDataForFocus(blockType: string, data: unknown): string {
    if (!data) return `[${blockType}] No data available`;

    switch (blockType) {
        case 'polymarket': {
            const markets = data as Array<{
                question: string;
                outcomes: Array<{ name: string; probability: number }>;
                volume?: number;
                endDate?: string;
            }>;
            if (!markets.length) return '[Polymarket] No markets loaded';

            const formatted = markets.slice(0, 10).map(m => {
                const outcomes = m.outcomes?.map(o =>
                    `  - ${o.name}: ${(o.probability * 100).toFixed(1)}%`
                ).join('\n') || '  No outcomes';
                return `📊 ${m.question}\n${outcomes}${m.volume ? `\n  Volume: $${m.volume.toLocaleString()}` : ''}`;
            }).join('\n\n');

            return `[POLYMARKET FOCUS - ${markets.length} markets]\n\n${formatted}`;
        }

        case 'newsapi': {
            const articles = data as Array<{
                title: string;
                source: { name: string };
                description?: string;
                publishedAt?: string;
            }>;
            if (!articles.length) return '[News] No articles loaded';

            const formatted = articles.slice(0, 10).map(a =>
                `📰 ${a.title}\n  Source: ${a.source?.name || 'Unknown'}${a.description ? `\n  ${a.description.slice(0, 200)}...` : ''}`
            ).join('\n\n');

            return `[NEWS FOCUS - ${articles.length} articles]\n\n${formatted}`;
        }

        default:
            try {
                return `[${blockType.toUpperCase()} FOCUS]\n${JSON.stringify(data, null, 2).slice(0, 2000)}`;
            } catch {
                return `[${blockType}] Data format unknown`;
            }
    }
}
