'use client';

// ============================================
// OMNIOS: MIND PANEL
// Unified Mind Interface - Shell | Systems | Projects
// ============================================

import { useState, useCallback } from 'react';
import { useMindStore } from '@/core/stores';
import { getMindEngine } from '@/core/services';
import { LLMProvider, PersonaConfig, ContextPool, ContextEntry } from '@/core/schemas/mind.schema';
import { MemoryConfirmModal } from './MemoryConfirmModal';
import { ThinkResultModal } from './ThinkResultModal';
import { ContextCaptureModal } from './ContextCaptureModal';
import { Brain, X, MousePointer2, Highlighter, Sparkles, Loader2, Check, Trash2, Pin, Eye, ChevronDown, ChevronRight, Users, MessageSquare, Share2, Settings as SettingsIcon } from 'lucide-react';
import './MindPanel.css';
interface MindPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function MindPanel({ isOpen, onClose }: MindPanelProps) {
    // Shell-specific state
    const [activeTab, setActiveTab] = useState<'personas' | 'context' | 'graph' | 'settings'>('personas');
    const [thinkResult, setThinkResult] = useState<string | null>(null);
    const [isThinking, setIsThinking] = useState(false);

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

        // Trigger Shell Mind to think
    const handleThink = useCallback(async () => {
        if (isThinking) return;

        setIsThinking(true);
        setThinkResult(null);

        try {
            const engine = getMindEngine();
            const result = await engine.think();

            if (result.success) {
                setThinkResult(result.response || 'Analysis complete.');
            } else {
                setThinkResult(`Error: ${result.error}`);
            }
        } catch (error) {
            setThinkResult(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsThinking(false);
        }
    }, [isThinking]);

    // Highlighter Listener
    const handleMouseUp = () => {
        if (activeTool !== 'highlighter') return;

        const selection = window.getSelection();
        const text = selection?.toString().trim();

        if (text && text.length > 0) {
            setSelectedText(text);
            setSelectionModalOpen(true);
            // selection?.removeAllRanges(); // Optional: clear selection
        }
    };

    if (!isOpen) return null;

    return (
        <div className="mind-panel-overlay" onClick={onClose} onMouseUp={handleMouseUp}>
            <div className={`mind-panel ${activeTool === 'highlighter' ? 'cursor-text' : ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="mind-panel-title">
                {/* Header */}
                <header className="mind-panel-header">
                    <div className="mind-title">
                        <div>
                            <p className="sy-label">Mind</p>
                            <h2 id="mind-panel-title">Personas and context</h2>
                        </div>
                    </div>

                    {/* Tool Strip */}
                    <div className="hidden sm:flex ml-auto" role="group" aria-label="Panel tool">
                        <button
                            type="button"
                            className="sy-icon-btn"
                            aria-pressed={activeTool === 'cursor'}
                            onClick={() => setActiveTool('cursor')}
                            title="Cursor Mode"
                            aria-label="Cursor"
                        >
                            <MousePointer2 />
                        </button>
                        <button
                            type="button"
                            className="sy-icon-btn"
                            aria-pressed={activeTool === 'highlighter'}
                            onClick={() => setActiveTool('highlighter')}
                            title="Context Highlighter"
                            aria-label="Highlight text to capture context"
                        >
                            <Highlighter />
                        </button>
                    </div>

                    <div className="mind-status">
                        <span className={`status-dot status-${status}`} />
                        <span className="status-text">{status}</span>
                    </div>
                    <button type="button" className="sy-icon-btn" onClick={onClose} aria-label="Close mind panel">
                        <X />
                    </button>
                </header>

                {/* Shell Mind Content */}
                <>
                        {/* Navigation Tabs */}
                        <nav className="mind-tabs">
                            {[
                                { id: 'personas', icon: <Users />, label: 'Personas' },
                                { id: 'context', icon: <MessageSquare />, label: 'Context' },
                                { id: 'graph', icon: <Share2 />, label: 'Graph' },
                                { id: 'settings', icon: <SettingsIcon />, label: 'Settings' }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    className={`mind-tab ${activeTab === tab.id ? 'active' : ''}`}
                                    aria-current={activeTab === tab.id ? 'page' : undefined}
                                    onClick={() => setActiveTab(tab.id as typeof activeTab)}
                                >
                                    <span className="tab-icon" aria-hidden="true">{tab.icon}</span>
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

                        {/* Think Result Modal - appears as centered glassmorphic popup */}
                        <ThinkResultModal
                            isOpen={!!thinkResult}
                            onClose={() => setThinkResult(null)}
                            response={thinkResult || ''}
                            personaName={activePersona?.name || 'The Mind'}
                            
                        />

                        {/* Footer with Think Button */}
                        <footer className="mind-footer">
                            {activePersona && (
                                <div className="active-persona-badge">
                                    <span className="persona-name">{activePersona.name}</span>
                                    <span className="persona-status">Active</span>
                                </div>
                            )}

                            <button
                                type="button"
                                aria-busy={isThinking}
                                className={`think-button ${isThinking ? 'thinking' : ''}`}
                                onClick={handleThink}
                                disabled={isThinking || process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO === '1'}
                            >
                                {isThinking ? (
                                    <>
                                        <Loader2 className="think-spinner" aria-hidden="true" />
                                        <span>{activePersona?.name ?? 'Mind'} is thinking…</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="think-icon" aria-hidden="true" />
                                        <span>Think</span>
                                    </>
                                )}
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
    const [question, setQuestion] = useState('');
    const [suggestion, setSuggestion] = useState<string | null>(null);
    const [suggestError, setSuggestError] = useState<string | null>(null);
    const [isSuggesting, setIsSuggesting] = useState(false);

    const suggestPersona = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!question.trim() || isSuggesting) return;
        setIsSuggesting(true);
        setSuggestion(null);
        setSuggestError(null);
        try {
            const response = await fetch('/api/jev-persona', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: question.trim() })
            });
            const result: unknown = await response.json();
            const persona = result && typeof result === 'object'
                ? (result as Record<string, unknown>).persona : null;
            if (!response.ok || typeof persona !== 'string' || !personas.some(p => p.id === persona)) {
                throw new Error('Persona suggestion is unavailable.');
            }
            setSuggestion(persona);
        } catch {
            setSuggestError('Persona suggestion is unavailable.');
        } finally {
            setIsSuggesting(false);
        }
    };

    return (
        <div>
            {process.env.NEXT_PUBLIC_OMNI_JEV_ENABLED === '1' && <form className="persona-suggest" onSubmit={suggestPersona}>
                <label htmlFor="persona-question">Find a perspective for your question</label>
                <div className="persona-suggest-controls">
                    <input
                        id="persona-question"
                        value={question}
                        onChange={event => { setQuestion(event.target.value); setSuggestion(null); }}
                        maxLength={500}
                        placeholder="What are you trying to understand?"
                    />
                    <button type="submit" disabled={isSuggesting || !question.trim()}>
                        {isSuggesting ? 'Asking Jev…' : 'Ask Jev'}
                    </button>
                </div>
                <p>Only this question is sent to OpenRouter. Your canvas and saved data stay in this browser.</p>
                {suggestion && (
                    <p role="status">
                        Jev suggests {personas.find(p => p.id === suggestion)?.name}. Select its card below if you agree.
                    </p>
                )}
                {suggestError && <p role="alert">{suggestError}</p>}
            </form>}
            <div className="personas-grid">
                {personas.map(persona => (
                <button
                    key={persona.id}
                    type="button"
                    aria-pressed={persona.id === activePersonaId}
                    className={`persona-card ${persona.id === activePersonaId ? 'active' : ''}`}
                    onClick={() => onSelect(persona.id)}
                >
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
                        <div className="persona-active-badge"><span className="sy-dot bg-[var(--sy-brand)]" aria-hidden="true" /> Active</div>
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
    const [isCrystallizing, setIsCrystallizing] = useState(false);

    const handleCrystallizeAndSave = async (entry: ContextEntry) => {
        setIsCrystallizing(true);
        try {
            const engine = getMindEngine();
            // Summarize the content to avoid "slop"
            const summary = await engine.summarizeContext(entry.content);

            setPendingSuggestion({
                ...entry,
                content: summary,
                metadata: { ...entry.metadata, source: 'manual_crystallization' }
            });
            setMemoryModalOpen(true);
        } catch (error) {
            console.error("Crystallization failed:", error);
            // Fallback to raw content if summarization fails
            setPendingSuggestion(entry);
            setMemoryModalOpen(true);
        } finally {
            setIsCrystallizing(false);
        }
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
        <div className="context-pools">
            {/* Header Actions */}
            <div className="flex justify-between items-center mb-4 px-2">
                <h3 className="sy-label">Context memory</h3>
                <button
                    type="button"
                    onClick={onClearAll}
                    className="btn btn-ghost !text-[var(--sy-danger)]"
                    title="Clear Observations, Predictions, Directives"
                >
                    <Trash2 className="w-4 h-4" aria-hidden="true" /> Clear context
                </button>
            </div>

            {/* Focused Blocks Section - Always visible at top */}
            {focusPool && (
                <div className="focus-section">
                    <div className="focus-header">
                        <Pin className="focus-icon" aria-hidden="true" />
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
                            <p className="focus-hint">Pin a block from its header to focus it for deeper analysis.</p>
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
                                                disabled={isCrystallizing}
                                                title="Crystallize to Memory"
                                            >
                                                {isCrystallizing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Brain className="w-4 h-4" aria-hidden="true" />}
                                            </button>
                                            <button
                                                className="focus-unpin-btn"
                                                onClick={() => entry.sourceBlockId && unpinBlock(entry.sourceBlockId)}
                                                title="Unpin"
                                                aria-label="Unpin"
                                            >
                                                <X className="w-4 h-4" aria-hidden="true" />
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
                        <Eye className="awareness-icon" aria-hidden="true" />
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
                            {expandedPool === pool.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
                                                    {Boolean(entry.metadata?.isMemorySuggestion) ? 'Suggestion' : entry.type}
                                                </span>
                                                <p className="entry-content">{entry.content}</p>
                                                <span className="entry-time">
                                                    {new Date(entry.timestamp).toLocaleTimeString()}
                                                </span>
                                            </div>

                                            {/* Allow saving suggestions to memory */}
                                            {!!entry.metadata?.isMemorySuggestion && (
                                                <button
                                                    className="sy-icon-btn"
                                                    onClick={() => handleCrystallizeAndSave(entry)}
                                                    disabled={isCrystallizing}
                                                    title="Save to Memory"
                                                >
                                                    <span className="sr-only">Save</span>
                                                    {isCrystallizing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Brain className="w-4 h-4" aria-hidden="true" />}
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
                        <p className="graph-empty-title">The knowledge graph is empty.</p>
                        <p className="graph-empty-hint">Add blocks to the shell and it fills in as they load.</p>
                    </div>
                ) : (
                    <div className="graph-placeholder">
                        <p>{graph.nodes.length} nodes are in the graph. A visual view is not built yet.</p>
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
    const providers: { id: LLMProvider; name: string; needsKey: boolean; envVar?: string }[] = [
        { id: 'local', name: 'Local (Ollama)', needsKey: false },
        { id: 'anthropic', name: 'Anthropic', needsKey: true, envVar: 'ANTHROPIC_API_KEY' },
        { id: 'google', name: 'Google Gemini', needsKey: true, envVar: 'GOOGLE_API_KEY' }
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
                            type="button"
                            aria-pressed={llmConfig.provider === provider.id}
                            className={`provider-card ${llmConfig.provider === provider.id ? 'active' : ''}`}
                            onClick={() => handleProviderSelect(provider.id)}
                        >
                            <span className="provider-name">{provider.name}</span>
                            {llmConfig.provider === provider.id && (
                                <Check className="provider-check" aria-label="Selected" />
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

export default MindPanel;
