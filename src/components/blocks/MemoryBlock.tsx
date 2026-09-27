'use client';

// ============================================
// PROJECT OMNI: MEMORY BLOCK
//
// A Mind pool as an object on the canvas. This replaces the per-persona
// "use global memory" toggles, which fed real context into prompts with no
// spatial representation — invisible input in a product whose whole claim is
// that context is something you can point at.
//
// It behaves like any other source: it holds its entries in block.data, so
// the wire system carries it with no special-casing, and cutting the wire
// actually removes the memory from the persona's context.
// ============================================

import { useEffect, useMemo, useState } from 'react';
import { Brain, Trash2, Plus } from 'lucide-react';
import { useMindStore, useBlockStore } from '@/core/stores';
import {
    createMemoryBlockData,
    type MemoryBlockData,
    type ContextEntry
} from '@/core/schemas/mind.schema';
import { cn } from '@/lib/utils';

/** Pools worth surfacing on a canvas, in the order a person would reach for them. */
const POOL_CHOICES: Array<{ id: string; label: string }> = [
    { id: 'memory', label: 'Long-term memory' },
    { id: 'observations', label: 'Observations' },
    { id: 'focus', label: 'Focused' },
    { id: 'inferences', label: 'Inferences' },
    { id: 'directives', label: 'Directives' },
    { id: 'predictions', label: 'Predictions' }
];

interface MemoryBlockProps {
    instanceId: string;
}

export function MemoryBlockView({ instanceId }: MemoryBlockProps) {
    const { getBlock, updateData } = useBlockStore();
    const contextPools = useMindStore(state => state.contextPools);
    const addToPool = useMindStore(state => state.addToPool);
    const [draft, setDraft] = useState('');

    const block = getBlock(instanceId);
    const data = (block?.data as MemoryBlockData) || createMemoryBlockData();

    // Live entries for the selected pool, newest last (how they read).
    const entries: ContextEntry[] = useMemo(() => {
        const pool = contextPools.find(p => p.id === data.poolId);
        return pool ? pool.entries.slice(-data.limit) : [];
    }, [contextPools, data.poolId, data.limit]);

    // Publish into block.data so the wire system carries this like any source.
    useEffect(() => {
        const current = (getBlock(instanceId)?.data as MemoryBlockData) || createMemoryBlockData();
        const unchanged =
            current.entries.length === entries.length &&
            current.entries.every((e, i) => e.id === entries[i]?.id);
        if (unchanged) return;
        updateData(instanceId, { ...current, entries });
    }, [entries, instanceId, getBlock, updateData]);

    const setPool = (poolId: string) => {
        const current = (getBlock(instanceId)?.data as MemoryBlockData) || createMemoryBlockData();
        updateData(instanceId, { ...current, poolId, entries: [] });
    };

    const removeEntry = (entryId: string) => {
        useMindStore.setState(state => ({
            contextPools: state.contextPools.map(p =>
                p.id === data.poolId
                    ? { ...p, entries: p.entries.filter(e => e.id !== entryId) }
                    : p
            )
        }));
    };

    const addEntry = () => {
        const content = draft.trim();
        if (!content) return;
        addToPool(data.poolId, { type: 'memory', content, importance: 0.6 });
        setDraft('');
    };

    return (
        <div className="flex flex-col h-full text-[var(--text-primary)]">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--citadel-border)]">
                <Brain className="w-3.5 h-3.5 text-[var(--citadel-secondary)]" />
                <select
                    value={data.poolId}
                    onChange={e => setPool(e.target.value)}
                    className="flex-1 bg-transparent text-xs text-[var(--text-primary)] outline-none cursor-pointer"
                    aria-label="Mind pool"
                >
                    {POOL_CHOICES.map(p => (
                        <option key={p.id} value={p.id} className="bg-[var(--citadel-surface)]">
                            {p.label}
                        </option>
                    ))}
                </select>
                <span className="text-xs text-[var(--text-muted)] tabular-nums">
                    {entries.length}
                </span>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
                {entries.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] py-3 text-center">
                        Nothing here yet. Anything you add is wired downstream.
                    </p>
                ) : (
                    entries.map(entry => (
                        <div
                            key={entry.id}
                            className="group flex items-start gap-2 px-2 py-1.5 rounded bg-[var(--citadel-surface)] border border-[var(--citadel-border)]"
                        >
                            <p className="flex-1 text-xs leading-snug">{entry.content}</p>
                            <button
                                onClick={() => removeEntry(entry.id)}
                                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[var(--text-muted)] hover:text-[var(--truth-red)] transition-opacity"
                                title="Forget this"
                                aria-label="Forget this entry"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                        </div>
                    ))
                )}
            </div>

            <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[var(--citadel-border)]">
                <input
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') addEntry();
                    }}
                    placeholder="Remember something…"
                    className="flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                />
                <button
                    onClick={addEntry}
                    disabled={!draft.trim()}
                    className={cn(
                        'p-1 rounded transition-colors',
                        draft.trim()
                            ? 'text-[var(--citadel-secondary)] hover:bg-[var(--citadel-secondary)]/10'
                            : 'text-[var(--text-muted)] opacity-50'
                    )}
                    title="Add to this pool"
                    aria-label="Add to this pool"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}

export default MemoryBlockView;
