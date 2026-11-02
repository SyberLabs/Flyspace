'use client';

// ============================================
// PROJECT OMNI: MIND PANEL
// Unified Mind Interface - Shell | Systems | Projects
// ============================================

import { useState, useEffect, useRef } from 'react';
import { useMindStore } from '@/core/stores';
import { LLMProvider, PersonaConfig, ContextPool, ContextEntry } from '@/core/schemas/mind.schema';
import { MemoryConfirmModal } from './MemoryConfirmModal';
import { ContextCaptureModal } from './ContextCaptureModal';
import './MindPanel.css';
interface MindPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function MindPanel({ isOpen, onClose }: MindPanelProps) {
    // Shell-specific state
    const [activeTab, setActiveTab] = useState<'personas' | 'context' | 'graph' | 'settings'>('personas');

    // Tool state
    const [activeTool, setActiveTool] = useState<'cursor' | 'highlighter'>('cursor');
    const [selectionModalOpen, setSelectionModalOpen] = useState(false);
    const [selectedText, setSelectedText] = useState('');

    const {
        status,
        llmConfig,
        personas,
        activePersonaId,
        contextPools,
        graph,
        setActivePersona,
        setProvider,
        clearPool,
        clearEphemeralContext
    } = useMindStore();

    const activePersona = personas.find(p => p.id === activePersonaId);

    // Highlighter Listener
    const handleMouseUp = () => {
        if (activeTool !== 'highlighter') return;

        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (text && text.length > 0) {
            setSelectedText(text);
            setSelectionModalOpen(true);
        }
    };

    // Initial focus lands on the dialog itself when it opens.
    const panelRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (isOpen) panelRef.current?.focus();
    }, [isOpen]);

    // Escape closes the panel unless the context capture modal is open; it owns
    // the key while it is up.
    const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.key !== 'Escape') return;
        if (selectionModalOpen) return;
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="mind-panel-overlay" onClick={onClose} onMouseUp={handleMouseUp}>
            {/* Modal: the overlay covers the canvas and a click on it closes */}
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="mind-panel-title"
                tabIndex={-1}
                onKeyDown={handlePanelKeyDown}
                className={`mind-panel ${activeTool === 'highlighter' ? 'cursor-text' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                {/* Glossy highlight overlay */}
                <div className="mind-panel-highlight" />

                {/* Floating bubbles background */}
                <div className="mind-bubbles">
                    <div className="bubble bubble-1" />
                    <div className="bubble bubble-2" />
                    <div className="bubble bubble-3" />
                    <div className="bubble bubble-4" />
                    <div className="bubble bubble-5" />
                </div>

                {/* Header */}
                <header className="mind-panel-header">
                    <div className="mind-title">
                        <span className="mind-icon" aria-hidden="true">🧠</span>
                        <div>
                            <h2 id="mind-panel-title">The Mind</h2>
                            <span className="mind-subtitle">Cognitive Substrate v2.0</span>
                        </div>
                    </div>

                    {/* Tool Strip */}
                    <div className="flex bg-black/20 rounded-lg p-1 gap-1 border border-white/5 mx-4">
                        <button
                            className={`p-1.5 rounded text-sm transition-colors ${activeTool === 'cursor' ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white'}`}
                            onClick={() => setActiveTool('cursor')}
                            title="Cursor Mode"
                            aria-label="Cursor Mode"
                            aria-pressed={activeTool === 'cursor'}
                        >
                            🖱️
                        </button>
                        <button
                            className={`p-1.5 rounded text-sm transition-colors ${activeTool === 'highlighter' ? 'bg-[var(--cyan-glow)]/20 text-[var(--cyan-glow)]' : 'text-white/50 hover:text-white'}`}
                            onClick={() => setActiveTool('highlighter')}
                            title="Context Highlighter"
                            aria-label="Context Highlighter"
                            aria-pressed={activeTool === 'highlighter'}
                        >
                            🖊️
                        </button>
                    </div>

                    <div className="mind-status">
                        <span className={`status-dot status-${status}`} />
                        <span className="status-text">{status}</span>
                    </div>
                    <button className="mind-close" onClick={onClose} aria-label="Close The Mind">✕</button>
                </header>

                {/* Shell Mind Content */}
                <>
                        {/* Navigation Tabs */}
                        <nav className="mind-tabs">
                            {[
                                { id: 'personas', icon: '👤', label: 'Personas' },
                                { id: 'context', icon: '💭', label: 'Context' },
                                { id: 'graph', icon: '🔗', label: 'Graph' },
                                { id: 'settings', icon: '⚙️', label: 'Settings' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    className={`mind-tab ${activeTab === tab.id ? 'active' : ''}`}
                                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                >
                                    <span className="tab-icon">{tab.icon}</span>
                                    <span className="tab-label">{tab.label}</span>
                                </button>
                            ))}
                        </nav>

                        {/* Content */}
                        <main className="mind-content">
                            {activeTab === 'personas' && (
                                <PersonasView
                                    personas={personas}
                                    activePersonaId={activePersonaId}
                                    onSelect={setActivePersona}
                                />
                            )}
                            {activeTab === 'context' && (
                                <ContextPoolsView
                                    pools={contextPools}
                                    onClear={clearPool}
                                    onClearAll={clearEphemeralContext}
                                />
                            )}
                            {activeTab === 'graph' && (
                                <GraphView graph={graph} />
                            )}
                            {activeTab === 'settings' && (
                                <SettingsView
                                    llmConfig={llmConfig}
                                    onProviderChange={setProvider}
                                />
                            )}
                        </main>

                        {/* Footer with Think Button */}
                        <footer className="mind-footer">
                            {activePersona && (
                                <div className="active-persona-badge">
                                    <span className="persona-avatar">{activePersona.avatar}</span>
                                    <span className="persona-name">{activePersona.name}</span>
                                    <span className="persona-status">Active</span>
                                </div>
                            )}

                            <button className="think-button" disabled>
                                <span className="think-icon">✨</span>
                                <span>Think</span>
                            </button>
                        </footer>
                </>

                <ContextCaptureModal
                    isOpen={selectionModalOpen}
                    onClose={() => setSelectionModalOpen(false)}
                    selectedText={selectedText}
                />
            </div>

        </div>
    );
}

// ============================================
// PERSONAS VIEW
// ============================================

interface PersonasViewProps {
    personas: PersonaConfig[];
    activePersonaId: string;
    onSelect: (id: string) => void;
}

function PersonasView({ personas, activePersonaId, onSelect }: PersonasViewProps) {
    return (
        <div>
            <div className="personas-grid">
                {personas.map(persona => (
                <button
                    key={persona.id}
                    className={`persona-card ${persona.id === activePersonaId ? 'active' : ''}`}
                    onClick={() => onSelect(persona.id)}
                >
                    <div className="persona-card-highlight" />
                    <div className="persona-avatar-large">{persona.avatar}</div>
                    <h3 className="persona-name">{persona.name}</h3>
                    <p className="persona-description">{persona.description}</p>

                    {/* Trait bars */}
                    <div className="persona-traits">
                        {persona.traits.slice(0, 4).map(trait => (
                            <div key={trait.id} className="trait-row">
                                <span className="trait-name">{trait.name}</span>
                                <div className="trait-bar">
                                    <div
                                        className="trait-fill"
                                        style={{ width: `${trait.value * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    {persona.id === activePersonaId && (
                        <div className="persona-active-badge">✓ Active</div>
                    )}
                </button>
                ))}
            </div>
        </div>
    );
}

// ============================================
// CONTEXT POOLS VIEW
// ============================================

interface ContextPoolsViewProps {
    pools: ContextPool[];
    onClear: (poolId: string) => void;
    onClearAll: () => void;
}

function ContextPoolsView({ pools, onClear, onClearAll }: ContextPoolsViewProps) {
    const [expandedPool, setExpandedPool] = useState<string | null>(null);
    const unpinBlock = useMindStore(state => state.unpinBlock);
    const clearFocus = useMindStore(state => state.clearFocus);
    const pushContext = useMindStore(state => state.pushContext);

    // Modal state for memory confirmation
    const [memoryModalOpen, setMemoryModalOpen] = useState(false);
    const [pendingSuggestion, setPendingSuggestion] = useState<ContextEntry | null>(null);

    const handleCrystallizeAndSave = (entry: ContextEntry) => {
        setPendingSuggestion({
            ...entry,
            content: 'Unable to crystallize: LLM unavailable.',
            metadata: { ...entry.metadata, source: 'manual_crystallization' }
        });
        setMemoryModalOpen(true);
    };

    const handleConfirmMemory = (content: string) => {
        pushContext('memory', {
            type: 'memory',
            content: content,
            importance: 1.0,
            metadata: { savedAt: Date.now(), source: pendingSuggestion?.metadata?.source || 'user_saved' }
        });
        setPendingSuggestion(null);
    };

    // Separate focus pool from others
    const focusPool = pools.find(p => p.id === 'focus');
    const otherPools = pools.filter(p => p.id !== 'focus');

    // Group observations by type
    const observationsPool = pools.find(p => p.id === 'observations');

    return (
        <div
            className="context-pools"
            onKeyDown={e => { if (e.key === 'Escape' && memoryModalOpen) e.stopPropagation(); }}
        >
            {/* Header Actions */}
            <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="text-sm font-medium text-white/50 uppercase tracking-wider">Context Memory</h3>
                <button
                    onClick={onClearAll}
                    className="text-xs px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 transition-colors flex items-center gap-1"
                    title="Clear Observations, Predictions, Directives"
                >
                    <span>🗑️</span> Clear Context
                </button>
            </div>

            {/* Focused Blocks Section - Always visible at top */}
            {focusPool && (
                <div className="focus-section">
                    <div className="focus-header">
                        <span className="focus-icon">📍</span>
                        <span className="focus-title">Focused Blocks</span>
                        <span className="focus-count">{focusPool.entries.length}/5</span>
                        {focusPool.entries.length > 0 && (
                            <button
                                className="focus-clear-btn"
                                onClick={() => clearFocus()}
                            >
                                Clear All
                            </button>
                        )}
                    </div>

                    {focusPool.entries.length === 0 ? (
                        <div className="focus-empty">
                            <p>No blocks pinned</p>
                            <p className="focus-hint">Click 📌 on any block to focus it for deep analysis</p>
                        </div>
                    ) : (
                        <div className="focus-blocks">
                            {focusPool.entries.map(entry => (
                                <div key={entry.id} className="focus-block-item">
                                    <div className="focus-block-header">
                                        <span className="focus-block-type">
                                            {(entry.metadata?.blockType as string) || 'block'}
                                        </span>
                                        <div className="flex items-center gap-1">
                                            <button
                                                className="focus-action-btn"
                                                onClick={() => handleCrystallizeAndSave(entry)}
                                                title="Crystallize to Memory"
                                                aria-label="Crystallize to Memory"
                                            >
                                                🧠
                                            </button>
                                            <button
                                                className="focus-unpin-btn"
                                                onClick={() => entry.sourceBlockId && unpinBlock(entry.sourceBlockId)}
                                                title="Unpin"
                                                aria-label="Unpin"
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    </div>
                                    <p className="focus-block-content">
                                        {entry.content.slice(0, 200)}...
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Awareness Status */}
            {observationsPool && (
                <div className="awareness-section">
                    <div className="awareness-header">
                        <span className="awareness-icon">👁️</span>
                        <span className="awareness-title">Awareness</span>
                        <span className="awareness-status">
                            {observationsPool.entries.length} observations tracked
                        </span>
                    </div>
                </div>
            )}

            {/* Other Context Pools */}
            <div className="pools-divider" />

            {otherPools.map(pool => (
                <div
                    key={pool.id}
                    className={`context-pool ${expandedPool === pool.id ? 'expanded' : ''}`}
                >
                    <button
                        className="pool-header"
                        onClick={() => setExpandedPool(expandedPool === pool.id ? null : pool.id)}
                    >
                        <span className="pool-icon">{pool.icon}</span>
                        <div className="pool-info">
                            <span className="pool-name">{pool.name}</span>
                            <span className="pool-count">{pool.entries.length} entries</span>
                        </div>
                        <div className="pool-capacity">
                            <div
                                className="pool-capacity-fill"
                                style={{ width: `${(pool.entries.length / pool.maxEntries) * 100}%` }}
                            />
                        </div>
                        <span className="pool-expand-icon">
                            {expandedPool === pool.id ? '▼' : '▶'}
                        </span>
                    </button>

                    {expandedPool === pool.id && (
                        <div className="pool-entries">
                            {pool.entries.length === 0 ? (
                                <div className="pool-empty">No entries yet</div>
                            ) : (
                                pool.entries.slice(-5).reverse().map(entry => (
                                    <div key={entry.id} className="pool-entry">
                                        <div className="flex justify-between items-start gap-2">
                                            <div>
                                                <span className="entry-type">
                                                    {Boolean(entry.metadata?.isMemorySuggestion) ? '🧠 Suggestion' : entry.type}
                                                </span>
                                                <p className="entry-content">{entry.content}</p>
                                                <span className="entry-time">
                                                    {new Date(entry.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>

                                            {/* Allow saving suggestions to memory */}
                                            {!!entry.metadata?.isMemorySuggestion && (
                                                <button
                                                    className="p-1 hover:bg-[var(--truth-amber)]/20 text-[var(--truth-amber)] rounded"
                                                    onClick={() => handleCrystallizeAndSave(entry)}
                                                    title="Save to Memory"
                                                    aria-label="Save to Memory"
                                                >
                                                    <span className="sr-only">Save</span>
                                                    🧠
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                            {pool.id !== 'memory' && !pool.isSystem && (
                                <button
                                    className="pool-clear-btn"
                                    onClick={() => onClear(pool.id)}
                                >
                                    Clear Pool
                                </button>
                            )}
                        </div>
                    )}
                </div>
            ))}

            {/* Memory Confirmation Modal */}
            <MemoryConfirmModal
                isOpen={memoryModalOpen}
                onClose={() => {
                    setMemoryModalOpen(false);
                    setPendingSuggestion(null);
                }}
                onConfirm={handleConfirmMemory}
                suggestion={pendingSuggestion?.content || ''}
                source={pendingSuggestion?.metadata?.source as string}
            />
        </div>
    );
}

// ============================================
// GRAPH VIEW
// ============================================

interface GraphViewProps {
    graph: { nodes: unknown[]; edges: unknown[]; lastUpdated: number };
}

function GraphView({ graph }: GraphViewProps) {
    return (
        <div className="graph-view">
            <div className="graph-stats">
                <div className="graph-stat">
                    <span className="stat-value">{graph.nodes.length}</span>
                    <span className="stat-label">Nodes</span>
                </div>
                <div className="graph-stat">
                    <span className="stat-value">{graph.edges.length}</span>
                    <span className="stat-label">Edges</span>
                </div>
                <div className="graph-stat">
                    <span className="stat-value">
                        {graph.lastUpdated ? new Date(graph.lastUpdated).toLocaleTimeString() : '—'}
                    </span>
                    <span className="stat-label">Last Update</span>
                </div>
            </div>

            <div className="graph-canvas">
                {graph.nodes.length === 0 ? (
                    <div className="graph-empty">
                        <span className="graph-empty-icon">🌊</span>
                        <p>Knowledge graph is empty</p>
                        <p className="graph-empty-hint">Add blocks to the Shell to populate the graph</p>
                    </div>
                ) : (
                    <div className="graph-placeholder">
                        <span className="graph-icon">🔮</span>
                        <p>Graph visualization coming soon</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// SETTINGS VIEW
// ============================================

interface SettingsViewProps {
    llmConfig: { provider: LLMProvider; model: string; temperature: number };
    onProviderChange: (provider: LLMProvider) => void;
}

function SettingsView({ llmConfig, onProviderChange }: SettingsViewProps) {
    const providers: { id: LLMProvider; name: string; icon: string; needsKey: boolean; envVar?: string }[] = [
        { id: 'local', name: 'Local (Ollama)', icon: '🏠', needsKey: false },
        { id: 'anthropic', name: 'Anthropic', icon: '🧠', needsKey: true, envVar: 'ANTHROPIC_API_KEY' },
        { id: 'google', name: 'Google Gemini', icon: '🔮', needsKey: true, envVar: 'GOOGLE_API_KEY' }
    ];

    const currentProvider = providers.find(p => p.id === llmConfig.provider);
    const needsApiKey = currentProvider?.needsKey ?? false;

    const handleProviderSelect = (providerId: LLMProvider) => {
        onProviderChange(providerId);
    };

    return (
        <div className="settings-view">
            <section className="settings-section">
                <h3 className="settings-title">LLM Provider</h3>
                <div className="provider-grid">
                    {providers.map(provider => (
                        <button
                            key={provider.id}
                            className={`provider-card ${llmConfig.provider === provider.id ? 'active' : ''}`}
                            onClick={() => handleProviderSelect(provider.id)}
                        >
                            <span className="provider-icon">{provider.icon}</span>
                            <span className="provider-name">{provider.name}</span>
                            {llmConfig.provider === provider.id && (
                                <span className="provider-check">✓</span>
                            )}
                        </button>
                    ))}
                </div>
            </section>

            {/* API Key — configured server-side via environment variables.
                Keys are never entered or stored in the browser. */}
            {needsApiKey && (
                <section className="settings-section">
                    <h3 className="settings-title">API Key</h3>
                    <div className="api-key-section">
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                            {currentProvider?.name} is configured on the server. Set
                            {' '}
                            <code className="px-1 py-0.5 rounded bg-[var(--citadel-surface)] text-[var(--text-primary)]">
                                {currentProvider?.envVar}
                            </code>
                            {' '}in your <code className="px-1 py-0.5 rounded bg-[var(--citadel-surface)] text-[var(--text-primary)]">.env</code> file.
                            Keys are never stored in the browser.
                        </p>
                    </div>
                </section>
            )}

            <section className="settings-section">
                <h3 className="settings-title">Current Configuration</h3>
                <div className="config-display">
                    <div className="config-row">
                        <span className="config-label">Provider</span>
                        <span className="config-value">{currentProvider?.name}</span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">Model</span>
                        <span className="config-value">{llmConfig.model}</span>
                    </div>
                    <div className="config-row">
                        <span className="config-label">Temperature</span>
                        <span className="config-value">{llmConfig.temperature}</span>
                    </div>
                </div>
            </section>
        </div>
    );
}
