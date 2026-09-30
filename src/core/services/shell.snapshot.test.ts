import { describe, it, expect, beforeEach } from 'vitest';
// localStorage is polyfilled in vitest.setup.ts so the persisted stores load.
import {
    formatSnapshotForLLM,
    captureShellSnapshot,
    type ShellSnapshot,
    type BlockSnapshotData
} from './shell.snapshot';
import { useBlockStore, useMindStore } from '@/core/stores';
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
        ...overrides
    };
}

function snapshot(overrides: Partial<ShellSnapshot> = {}): ShellSnapshot {
    return {
        timestamp: Date.now(),
        totalBlocks: 0,
        blocks: [],
        focusedBlocks: [],
        observations: [],
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
        expect(out).toContain('Total Blocks: 3');
        expect(out).toContain('## ALL BLOCKS ON CANVAS');
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

    it('includes focused blocks and recent observations when present', () => {
        const out = formatSnapshotForLLM(snapshot({
            focusedBlocks: [{
                id: 'f1', type: 'observation', content: 'PINNED INSIGHT',
                importance: 1, timestamp: Date.now()
            }],
            observations: [{
                id: 'o1', type: 'analysis', content: 'an observation',
                importance: 0.8, timestamp: Date.now()
            }]
        }));

        expect(out).toContain('FOCUSED BLOCKS');
        expect(out).toContain('PINNED INSIGHT');
        expect(out).toContain('RECENT OBSERVATIONS');
        expect(out).toContain('[analysis] an observation');
    });

    it('omits optional sections when empty', () => {
        const out = formatSnapshotForLLM(snapshot());
        expect(out).not.toContain('FOCUSED BLOCKS');
        expect(out).not.toContain('RECENT OBSERVATIONS');
    });
});

describe('captureShellSnapshot', () => {
    beforeEach(() => {
        // Reset the block store to a known empty state.
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('returns an empty snapshot when no blocks exist', () => {
        const snap = captureShellSnapshot();
        expect(snap.totalBlocks).toBe(0);
        expect(snap.blocks).toHaveLength(0);
    });

    it('counts blocks and aggregates stats from the block store', () => {
        const mkBlock = (id: string, status: BlockInstance['status']): BlockInstance => ({
            instance_id: id,
            schema: {
                block_id: 'polymarket',
                display_name: 'Polymarket',
                category: 'truth'
            } as unknown as BlockInstance['schema'],
            status,
            last_updated: null,
            data: null,
            position: { x: 0, y: 0 },
            dimensions: { width: 320, height: 240 },
            shellId: 'root'
        });

        useBlockStore.setState({
            blocks: [mkBlock('a', 'connected'), mkBlock('b', 'error')],
           
            activeShellId: 'root'
        });

        // Ensure mind store has no pins for these.
        expect(typeof useMindStore.getState().isPinned).toBe('function');

        const snap = captureShellSnapshot();
        expect(snap.totalBlocks).toBe(2);
        expect(snap.stats.connectedBlocks).toBe(1);
        expect(snap.stats.errorBlocks).toBe(1);
        expect(snap.stats.blocksByCategory.truth).toBe(2);
    });
});
