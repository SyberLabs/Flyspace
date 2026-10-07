import { describe, it, expect, beforeEach } from 'vitest';
// localStorage is polyfilled in vitest.setup.ts.
import { useShellStore } from './shellStore';
import { useBlockStore } from './blockStore';
import { useWireStore } from './wireStore';
import { blockRegistry } from '../registry/BlockRegistry';
import { DEFAULT_WIRE_FILTERS } from '../schemas/wire.schema';
import { getShellTemplate, type ShellTemplate } from '../shells/templates';

const investor = getShellTemplate('tmpl_investor') as ShellTemplate;

/** The analyst persona block of a live shell, with a conversation in it. */
function talkToAnalyst(shellId: string) {
    const blocks = useBlockStore.getState().getBlocksByShell(shellId);
    const analyst = blocks.find(b => b.schema.block_id === 'persona_analyst')!;
    expect(analyst).toBeDefined();
    const messages = [
        { id: 'm1', role: 'user', content: 'What moved today?', timestamp: 1 },
        { id: 'm2', role: 'assistant', content: 'Odds on the fed cut rose.', timestamp: 2 }
    ];
    useBlockStore.getState().updateData(analyst.instance_id, {
        personaType: 'analyst',
        messages,
        isCollapsed: false,
        isThinking: false
    });
    useBlockStore.getState().updateStatus(analyst.instance_id, 'connected');
    return { analystId: analyst.instance_id, messages };
}

describe('shell switch keeps what is live', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });

    it('opening the shell that is already live keeps the persona conversation', () => {
        // "open investor" while already on Investor (speech session.ts) re-runs loadShell.
        const shellId = useShellStore.getState().instantiateTemplate(investor)!;
        const { analystId, messages } = talkToAnalyst(shellId);

        expect(useShellStore.getState().loadShell(shellId)).toBe(true);

        const analyst = useBlockStore.getState().getBlock(analystId)!;
        expect(analyst).toBeDefined();
        expect((analyst.data as { messages: unknown }).messages).toEqual(messages);
        expect(analyst.status).toBe('connected');
        expect(useBlockStore.getState().activeShellId).toBe(shellId);
    });

    it('switching A → B → A keeps A’s blocks, positions, data and wires', () => {
        const a = useShellStore.getState().instantiateTemplate(investor)!;
        const { analystId, messages } = talkToAnalyst(a);
        useBlockStore.getState().updatePosition(analystId, { x: 999, y: 777 });
        // A block added live after the template was instantiated: not in the snapshot.
        const schema = blockRegistry.get('polymarket_live_odds')!;
        const addedId = useBlockStore.getState().addBlock(schema, { x: 10, y: 20 }, a);
        const aBlocksBefore = useBlockStore.getState().getBlocksByShell(a);
        const aWiresBefore = useWireStore.getState().getWiresByShell(a);
        expect(aWiresBefore.length).toBeGreaterThan(0);

        const b = useShellStore.getState().instantiateTemplate(investor)!;
        expect(useBlockStore.getState().activeShellId).toBe(b);
        // Switching away changed nothing in A.
        expect(useBlockStore.getState().getBlocksByShell(a)).toEqual(aBlocksBefore);

        expect(useShellStore.getState().loadShell(a)).toBe(true);

        expect(useBlockStore.getState().activeShellId).toBe(a);
        expect(useShellStore.getState().activeShellId).toBe(a);
        expect(useBlockStore.getState().getBlocksByShell(a)).toEqual(aBlocksBefore);
        expect(useWireStore.getState().getWiresByShell(a)).toEqual(aWiresBefore);
        const analyst = useBlockStore.getState().getBlock(analystId)!;
        expect(analyst.position).toEqual({ x: 999, y: 777 });
        expect((analyst.data as { messages: unknown }).messages).toEqual(messages);
        expect(useBlockStore.getState().getBlock(addedId)).toBeDefined();
        // B is still there, just not on the canvas.
        expect(useBlockStore.getState().getBlocksByShell(b)).toHaveLength(investor.blocks.length);
    });

    it('a shell with no live blocks is seeded from its snapshot (first open, restored shell)', () => {
        const saved = {
            id: 'shell_saved_1',
            type: 'custom' as const,
            name: 'Saved',
            blocks: [
                { blockId: 'polymarket_live_odds', instanceId: 'pm_1', position: { x: 0, y: 0 }, dimensions: { width: 320, height: 240 } },
                { blockId: 'persona_analyst', instanceId: 'an_1', position: { x: 400, y: 0 }, dimensions: { width: 320, height: 400 } }
            ],
            wires: [{
                id: 'w1', sourceBlockId: 'pm_1', targetBlockId: 'an_1', wireType: 'push' as const,
                filters: { ...DEFAULT_WIRE_FILTERS }, status: 'active' as const, shellId: 'shell_saved_1'
            }],
            persona: 'analyst' as const,
            aesthetic: 'command' as const,
            createdAt: 1,
            updatedAt: 1
        };
        useShellStore.setState(state => ({ shells: [...state.shells, saved] }) as never);

        expect(useShellStore.getState().loadShell('shell_saved_1')).toBe(true);

        expect(useBlockStore.getState().getBlocksByShell('shell_saved_1').map(b => b.instance_id).sort())
            .toEqual(['an_1', 'pm_1']);
        expect(useWireStore.getState().getWiresByShell('shell_saved_1')).toHaveLength(1);
        expect(useBlockStore.getState().activeShellId).toBe('shell_saved_1');
    });
});

describe('saveShell snapshots the live canvas of the shell', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });

    it('"Save Current" on a live shell writes its blocks, positions, data and wires into that shell', () => {
        const shellId = useShellStore.getState().instantiateTemplate(investor)!;
        const before = useShellStore.getState().shells.find(s => s.id === shellId)!;
        const { analystId, messages } = talkToAnalyst(shellId);
        useBlockStore.getState().updatePosition(analystId, { x: 123, y: 456 });
        const schema = blockRegistry.get('polymarket_live_odds')!;
        const addedId = useBlockStore.getState().addBlock(schema, { x: 10, y: 20 }, shellId);
        const liveBlocks = useBlockStore.getState().getBlocksByShell(shellId);
        const liveWires = useWireStore.getState().getWiresByShell(shellId);

        const saved = useShellStore.getState().saveShell(shellId, { name: 'Renamed', description: 'd' });

        expect(saved.blocks.map(b => b.instanceId).sort()).toEqual(liveBlocks.map(b => b.instance_id).sort());
        expect(saved.blocks.some(b => b.instanceId === addedId)).toBe(true);
        const analyst = saved.blocks.find(b => b.instanceId === analystId)!;
        expect(analyst.position).toEqual({ x: 123, y: 456 });
        expect((analyst.config?.data as { messages: unknown }).messages).toEqual(messages);
        expect(saved.wires).toEqual(liveWires);
        // Identity and metadata the dialog did not ask for are kept.
        expect(saved.id).toBe(shellId);
        expect(saved.name).toBe('Renamed');
        expect(saved.description).toBe('d');
        expect(saved.createdAt).toBe(before.createdAt);
        expect(saved.templateTags).toEqual(before.templateTags);
        // One record per shell in the store.
        expect(useShellStore.getState().shells.filter(s => s.id === shellId)).toHaveLength(1);
        expect(useShellStore.getState().shells.find(s => s.id === shellId)!.blocks).toEqual(saved.blocks);
    });

    it('saving without a name keeps the shell’s name', () => {
        const shellId = useShellStore.getState().instantiateTemplate(investor)!;
        const saved = useShellStore.getState().saveShell(shellId);
        expect(saved.name).toBe(investor.name);
    });
});
