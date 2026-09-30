import { describe, it, expect, beforeEach } from 'vitest';
// localStorage is polyfilled in vitest.setup.ts so the persisted stores load.
import {
    formatSnapshotForLLM,
    captureShellSnapshot,
    type ShellSnapshot,
    type BlockSnapshotData
} from './shell.snapshot';
import { useBlockStore, useMindStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import type { DataWire } from '@/core/schemas/wire.schema';
import type { BlockInstance } from '@/core/schemas/block.schema';

function block(overrides: Partial<BlockSnapshotData> = {}): BlockSnapshotData {
    return {
        instanceId: 'inst-1',
        blockType: 'polymarket',
        displayName: 'Polymarket',
        category: 'truth',
        status: 'connected',
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 240 },
        lastUpdated: null,
        isPinned: false,
        data: null,
        summary: 'A market summary',
        keyMetrics: [],
        ...overrides
    };
}

function snapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
    return {
        timestamp: Date.now(),
        totalBlocks: 0,
        blocks: [],
        focusedBlocks: [],
        connections: [],
        stats: {
            connectedBlocks: 0,
            disconnectedBlocks: 0,
            errorBlocks: 0,
            blocksByCategory: {},
            dataAge: { newest: null, oldest: null }
        },
        ...overrides
    };
}

describe('formatSnapshotForLLM', () => {
    it('renders the header and overview', () => {
        const out = formatSnapshotForLLM(snapshot({ totalBlocks: 3 }));
        expect(out).toContain('SHELL LANDSCAPE SNAPSHOT');
        expect(out).toContain('Blocks in scope: 3');
        expect(out).toContain('## WIRED OR PINNED BLOCKS IN THIS SHELL');
    });

    it('groups blocks by category and marks status + pin icons', () => {
        const out = formatSnapshotForLLM(snapshot({
            totalBlocks: 2,
            blocks: [
                block({ category: 'truth', displayName: 'Polymarket', status: 'connected' }),
                block({ instanceId: 'i2', category: 'pulse', displayName: 'News', status: 'error', isPinned: true, error: 'boom' })
            ],
            stats: {
                connectedBlocks: 1, disconnectedBlocks: 0, errorBlocks: 1,
                blocksByCategory: { truth: 1, pulse: 1 },
                dataAge: { newest: null, oldest: null }
            }
        }));

        expect(out).toContain('### TRUTH (1)');
        expect(out).toContain('### PULSE (1)');
        expect(out).toContain('🟢 **Polymarket**');
        expect(out).toContain('📌 🔴 **News**');
        expect(out).toContain('⚠️ Error: boom');
    });

    it('includes focused blocks when present', () => {
        const out = formatSnapshotForLLM(snapshot({
            focusedBlocks: [{
                id: 'f1', type: 'observation', content: 'PINNED INSIGHT',
                importance: 1, timestamp: Date.now()
            }]
        }));

        expect(out).toContain('FOCUSED BLOCKS');
        expect(out).toContain('PINNED INSIGHT');
    });

    it('omits optional sections when empty', () => {
        const out = formatSnapshotForLLM(snapshot());
        expect(out).not.toContain('FOCUSED BLOCKS');
    });
});

function wire(id: string, from: string, to: string, shellId: string): DataWire {
    return {
        id,
        sourceBlockId: from,
        targetBlockId: to,
        wireType: 'push',
        status: 'active',
        filters: { autoRefresh: true },
        shellId
    } as unknown as DataWire;
}

function mkScoped(id: string, shellId: string, status: BlockInstance['status'] = 'connected'): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'polymarket', display_name: id, category: 'truth' },
        status,
        last_updated: null,
        data: null,
        position: { x: 0, y: 0 },
        dimensions: { width: 320, height: 240 },
        shellId
    } as unknown as BlockInstance;
}

describe('captureShellSnapshot', () => {
    beforeEach(() => {
        // Reset the block store to a known empty state.
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] });
    });

    it('returns an empty snapshot when no blocks exist', () => {
        const snap = captureShellSnapshot();
        expect(snap.totalBlocks).toBe(0);
        expect(snap.blocks).toHaveLength(0);
    });

    it('counts blocks and aggregates stats from the block store', () => {
        useBlockStore.setState({
            blocks: [mkScoped('a', 'root'), mkScoped('b', 'root', 'error')],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [wire('w1', 'a', 'b', 'root')] });

        // Ensure mind store has no pins for these.
        expect(typeof useMindStore.getState().isPinned).toBe('function');

        const snap = captureShellSnapshot();
        expect(snap.totalBlocks).toBe(2);
        expect(snap.stats.connectedBlocks).toBe(1);
        expect(snap.stats.errorBlocks).toBe(1);
        expect(snap.stats.blocksByCategory.truth).toBe(2);
    });

    it('keeps only active-shell blocks that are wired (either end) or pinned', () => {
        useBlockStore.setState({
            blocks: [
                mkScoped('src', 'root'), mkScoped('sink', 'root'), mkScoped('loose', 'root'),
                mkScoped('pinned', 'root'), mkScoped('o1', 'other'), mkScoped('o2', 'other')
            ],
            activeShellId: 'root'
        });
        useWireStore.setState({
            wires: [
                wire('w1', 'src', 'sink', 'root'),
                wire('w2', 'o1', 'o2', 'other'),
                // A stray cross-shell wire must not pull a foreign block in.
                wire('w3', 'loose', 'o1', 'root')
            ]
        });
        useMindStore.getState().pinBlock('pinned', 'polymarket', null);
        useMindStore.getState().pinBlock('o2', 'polymarket', null);

        const snap = captureShellSnapshot();

        expect(snap.blocks.map(b => b.instanceId).sort()).toEqual(['pinned', 'sink', 'src']);
        expect(snap.totalBlocks).toBe(3);
        expect(snap.connections).toEqual([{ sourceBlockId: 'src', targetBlockId: 'sink' }]);
        expect(snap.focusedBlocks.map(e => e.sourceBlockId)).toEqual(['pinned']);
    });

    it('does not send the observations pool (earlier answers, awareness aggregates) to the model', () => {
        useMindStore.getState().updateAwareness('polymarket', 'ALL-SHELL AGGREGATE');
        useMindStore.getState().addToPool('observations', {
            type: 'analysis', content: 'a prior Think answer', importance: 0.8
        });

        const out = formatSnapshotForLLM(captureShellSnapshot());

        expect(out).not.toContain('a prior Think answer');
        expect(out).not.toContain('ALL-SHELL AGGREGATE');
    });
});
