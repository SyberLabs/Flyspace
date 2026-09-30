import { describe, it, expect, beforeEach } from 'vitest';
// localStorage is polyfilled in vitest.setup.ts.
import { useShellStore } from './shellStore';
import { useBlockStore } from './blockStore';
import { useWireStore } from './wireStore';
import { getShellTemplate, type ShellTemplate } from '../shells/templates';

const investor = getShellTemplate('tmpl_investor') as ShellTemplate;

describe('shell workflow — createShell', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('creates an EMPTY shell (not a copy of the current canvas)', () => {
        // Populate the current canvas first.
        useShellStore.getState().instantiateTemplate(investor);
        expect(useBlockStore.getState().blocks.length).toBeGreaterThan(0);

        const newShell = useShellStore.getState().createShell('Blank', 'desc');

        // The new shell has no blocks of its own...
        expect(newShell.blocks).toEqual([]);
        expect(newShell.wires).toEqual([]);
        // ...and the canvas (which follows the active shell) is now empty.
        expect(useBlockStore.getState().activeShellId).toBe(newShell.id);
        expect(useBlockStore.getState().getBlocksByShell(newShell.id)).toHaveLength(0);
    });

    it('does not destroy the previous shell’s blocks', () => {
        const spawnedId = useShellStore.getState().instantiateTemplate(investor)!;
        const before = useBlockStore.getState().getBlocksByShell(spawnedId).length;
        expect(before).toBeGreaterThan(0);

        useShellStore.getState().createShell('Blank');

        // Old shell's blocks still exist (just not shown on the canvas).
        expect(useBlockStore.getState().getBlocksByShell(spawnedId)).toHaveLength(before);
    });
});

describe('shell workflow — deleteShell', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('removes the shell and clears its orphaned blocks', () => {
        const id = useShellStore.getState().instantiateTemplate(investor)!;
        expect(useBlockStore.getState().getBlocksByShell(id).length).toBeGreaterThan(0);

        useShellStore.getState().deleteShell(id);

        // Shell gone, and its blocks no longer linger in the block store.
        expect(useShellStore.getState().shells.some(s => s.id === id)).toBe(false);
        expect(useBlockStore.getState().getBlocksByShell(id)).toHaveLength(0);
    });

    it('falls back to root on the canvas when deleting the active shell', () => {
        const id = useShellStore.getState().instantiateTemplate(investor)!;
        expect(useBlockStore.getState().activeShellId).toBe(id);

        useShellStore.getState().deleteShell(id);

        expect(useBlockStore.getState().activeShellId).toBe('root');
    });

    it('leaves the canvas alone when deleting a non-active shell', () => {
        const a = useShellStore.getState().instantiateTemplate(investor)!; // becomes active
        const b = useShellStore.getState().instantiateTemplate(investor)!; // now active
        expect(useBlockStore.getState().activeShellId).toBe(b);

        useShellStore.getState().deleteShell(a); // delete the non-active one

        // Canvas still on b; b's blocks intact.
        expect(useBlockStore.getState().activeShellId).toBe(b);
        expect(useBlockStore.getState().getBlocksByShell(b).length).toBeGreaterThan(0);
    });
});

describe('shell workflow — wire cleanup (A1 orphan-wire regressions)', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });

    it('deleting a shell removes its wires (no orphans)', () => {
        const id = useShellStore.getState().instantiateTemplate(investor)!;
        expect(useWireStore.getState().getWiresByShell(id).length).toBeGreaterThan(0);

        useShellStore.getState().deleteShell(id);

        expect(useWireStore.getState().getWiresByShell(id)).toHaveLength(0);
    });

    it('removing a block removes the wires touching it (previously leaked)', () => {
        const id = useShellStore.getState().instantiateTemplate(investor)!;
        const blocks = useBlockStore.getState().getBlocksByShell(id);
        const analyst = blocks.find(b => b.schema.block_id === 'persona_analyst')!;
        expect(useWireStore.getState().getWiresToBlock(analyst.instance_id).length).toBeGreaterThan(0);

        useBlockStore.getState().removeBlock(analyst.instance_id);

        expect(useWireStore.getState().getWiresToBlock(analyst.instance_id)).toHaveLength(0);
        expect(useWireStore.getState().getWiresFromBlock(analyst.instance_id)).toHaveLength(0);
    });

    it('legacy shells (BlockConnection[]) convert to live wires on load', () => {
        // Simulate a pre-A1 persisted shell carrying legacy connections.
        const legacyShell = {
            id: 'shell_legacy_1',
            name: 'Legacy',
            blocks: [
                { blockId: 'polymarket_live_odds', instanceId: 'pm_1', position: { x: 0, y: 0 }, dimensions: { width: 320, height: 240 } },
                { blockId: 'persona_analyst', instanceId: 'an_1', position: { x: 400, y: 0 }, dimensions: { width: 320, height: 400 } }
            ],
            wires: undefined as never,
            connections: [{ id: 'c1', sourceBlockId: 'pm_1', sourcePort: 'out', targetBlockId: 'an_1', targetPort: 'in' }],
            createdAt: 1,
            updatedAt: 1
        };
        useShellStore.setState(state => ({ shells: [...state.shells, legacyShell] }) as never);

        expect(useShellStore.getState().loadShell('shell_legacy_1')).toBe(true);

        const wires = useWireStore.getState().getWiresByShell('shell_legacy_1');
        expect(wires).toHaveLength(1);
        expect(wires[0].sourceBlockId).toBe('pm_1');
        expect(wires[0].targetBlockId).toBe('an_1');
        expect(wires[0].status).toBe('active');
    });
});
