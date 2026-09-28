'use client';

import { useState } from 'react';
import { useBlockStore } from '@/core/stores';
import { runInstalledCapability, useCapabilityStore } from '@/core/capabilities';
import type { OmniItem } from '@/core/gateway';

function readItems(data: unknown): OmniItem[] {
    if (!data || typeof data !== 'object' || !('items' in data)) return [];
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is OmniItem =>
        !!item && typeof item === 'object' && typeof (item as OmniItem).title === 'string'
    );
}

function readTypedKind(data: unknown): string | null {
    if (!data || typeof data !== 'object' || !('typed' in data)) return null;
    const typed = (data as { typed?: { schema?: { kind?: string } } | null }).typed;
    return typed?.schema?.kind ?? null;
}

/**
 * One view for every runtime capability.
 * Mounting the view is not an execution request. The user runs it.
 * Write and destructive also wait until approval.
 */
export function CapabilityBlockView({ instanceId }: { instanceId: string }) {
    const block = useBlockStore(state => state.getBlock(instanceId));
    const capabilityId = block?.schema.capabilityId ?? '';
    const manifest = useCapabilityStore(state => state.manifests.find(entry => entry.id === capabilityId));
    const [running, setRunning] = useState(false);

    const sideEffect = manifest?.effect === 'write' || manifest?.effect === 'destructive';

    const run = () => {
        if (!manifest || running) return;
        if (sideEffect && manifest.approval !== 'approved') return;
        setRunning(true);
        void runInstalledCapability(instanceId).finally(() => setRunning(false));
    };

    const items = readItems(block?.data);
    const typedKind = readTypedKind(block?.data);
    const blocked = sideEffect && manifest?.approval !== 'approved';

    return (
        <div className="flex h-full flex-col gap-2 p-3 text-sm text-[var(--text-primary)]">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span>{manifest?.effect ?? 'missing'} · {manifest?.approval ?? 'uninstalled'}</span>
                {typedKind ? <span>typed {typedKind}</span> : null}
            </div>
            {block?.error ? (
                <p className="text-xs text-[var(--truth-red)]">{block.error}</p>
            ) : null}
            {items.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)]">
                    {manifest ? 'No result yet.' : 'This capability is not installed.'}
                </p>
            ) : (
                <ul className="min-h-0 flex-1 space-y-1 overflow-auto">
                    {items.slice(0, 8).map(item => (
                        <li key={item.id} className="truncate">{item.title}</li>
                    ))}
                </ul>
            )}
            <button
                type="button"
                onClick={run}
                disabled={!manifest || running || blocked}
                className="rounded border border-[var(--citadel-border)] px-2 py-1 text-xs disabled:opacity-50"
            >
                {running ? 'Running…' : blocked ? 'Needs approval' : 'Run'}
            </button>
        </div>
    );
}
