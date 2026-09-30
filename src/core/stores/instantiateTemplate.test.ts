import { describe, it, expect, beforeEach } from 'vitest';
// localStorage is polyfilled in vitest.setup.ts so the persisted stores load.
import { useShellStore } from './shellStore';
import { useBlockStore } from './blockStore';
import { useWireStore } from './wireStore';
import { aggregateWireContext } from '../services/wire.service';
import { getShellTemplate, type ShellTemplate } from '../shells/templates';

const investor = getShellTemplate('tmpl_investor') as ShellTemplate;

describe('instantiateTemplate', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });

    it('creates a fresh shell populated with all the template blocks', () => {
        const shellId = useShellStore.getState().instantiateTemplate(investor);
        expect(shellId).toBeTruthy();

        const blocks = useBlockStore.getState().getBlocksByShell(shellId!);
        expect(blocks).toHaveLength(investor.blocks.length);
        // Every block carries the new shell id and a real schema (recreated via registry).
        for (const b of blocks) {
            expect(b.shellId).toBe(shellId);
            expect(b.schema).toBeDefined();
        }
        // The shell is registered and active.
        expect(useShellStore.getState().shells.some(s => s.id === shellId)).toBe(true);
        expect(useBlockStore.getState().activeShellId).toBe(shellId);
    });

    it('creates real DataWires — the wires RENDER (wireStore) with no dangling refs', () => {
        // A1 regression: template wiring must land in the single wire system
        // (wireStore), which is what WireRenderer draws and personas consume.
        const shellId = useShellStore.getState().instantiateTemplate(investor)!;
        const wires = useWireStore.getState().getWiresByShell(shellId);
        const blockIds = new Set(useBlockStore.getState().getBlocksByShell(shellId).map(b => b.instance_id));

        expect(wires.length).toBe(investor.connections.length);
        for (const w of wires) {
            // Both endpoints point at real, newly-created block instances.
            expect(blockIds.has(w.sourceBlockId)).toBe(true);
            expect(blockIds.has(w.targetBlockId)).toBe(true);
            expect(w.status).toBe('active');
            expect(w.shellId).toBe(shellId);
        }
    });

    it('template wires FEED personas — data flows into aggregateWireContext', () => {
        // A1 regression: this is the exact live bug — the Investor shell spawned
        // with inert wiring, so personas received no context until hand-wired.
        const shellId = useShellStore.getState().instantiateTemplate(investor)!;
        const blocks = useBlockStore.getState().getBlocksByShell(shellId);
        const analyst = blocks.find(b => b.schema.block_id === 'persona_analyst')!;
        const polymarket = blocks.find(b => b.schema.block_id === 'polymarket_live_odds')!;
        expect(analyst).toBeDefined();
        expect(polymarket).toBeDefined();

        // The template wire from Polymarket to the Analyst must exist as a live DataWire…
        const wiresToAnalyst = useWireStore.getState().getWiresToBlock(analyst.instance_id);
        expect(wiresToAnalyst.some(w => w.sourceBlockId === polymarket.instance_id)).toBe(true);

        // …and once the data block has data, it must flow into the persona's context.
        useBlockStore.getState().updateData(polymarket.instance_id, [{
            id: 'm1',
            question: 'Will France win the 2026 World Cup?',
            outcomes: [
                { id: 'm1-yes', name: 'Yes', probability: 0.174 },
                { id: 'm1-no', name: 'No', probability: 0.826 }
            ],
            volume: 86000000,
            liquidity: 0,
            endDate: '2026-07-19',
            category: 'Sports',
            tags: ['sports']
        }]);

        const { context, sourceIds } = aggregateWireContext(analyst.instance_id);
        expect(sourceIds).toContain(polymarket.instance_id);
        expect(context).toContain('Will France win the 2026 World Cup?');
        expect(context).toContain('17.4%'); // the probability, not just the title
    });

    it('produces independent copies on repeated use (distinct instance ids)', () => {
        const a = useShellStore.getState().instantiateTemplate(investor)!;
        const b = useShellStore.getState().instantiateTemplate(investor)!;
        expect(a).not.toBe(b);

        const idsA = useBlockStore.getState().getBlocksByShell(a).map(x => x.instance_id);
        const idsB = useBlockStore.getState().getBlocksByShell(b).map(x => x.instance_id);
        // No instance id is shared between the two spawned shells.
        expect(idsA.some(id => idsB.includes(id))).toBe(false);
    });

    it('honors a custom name', () => {
        const shellId = useShellStore.getState().instantiateTemplate(investor, 'My Investor')!;
        const shell = useShellStore.getState().shells.find(s => s.id === shellId)!;
        expect(shell.name).toBe('My Investor');
    });

    it('copies a template block\'s params onto the created instance', () => {
        // Templates aim fetches (e.g. GDP growth, not the World Bank dollar-GDP default).
        // If this is dropped, every spawned shell is generic again.
        const aimed: ShellTemplate = {
            ...investor,
            id: 'tmpl_aimed',
            blocks: [
                {
                    ref: 'worldbank',
                    blockId: 'worldbank_indicator',
                    position: { x: 0, y: 0 },
                    params: { indicator: 'NY.GDP.MKTP.KD.ZG', country: 'USA' }
                },
                { ref: 'analyst', blockId: 'persona_analyst', position: { x: 400, y: 0 } }
            ],
            connections: []
        };
        const shellId = useShellStore.getState().instantiateTemplate(aimed)!;
        const wb = useBlockStore.getState()
            .getBlocksByShell(shellId)
            .find(b => b.schema.block_id === 'worldbank_indicator');
        expect(wb?.params).toEqual({ indicator: 'NY.GDP.MKTP.KD.ZG', country: 'USA' });
    });

    it('the Researcher template aims OpenAlex and wires Memory into the persona', () => {
        const researcher = getShellTemplate('tmpl_researcher')!;
        const shellId = useShellStore.getState().instantiateTemplate(researcher)!;
        const blocks = useBlockStore.getState().getBlocksByShell(shellId);
        const openalex = blocks.find(b => b.schema.block_id === 'openalex_works');
        const memory = blocks.find(b => b.schema.block_id === 'memory_pool');
        const persona = blocks.find(b => b.schema.block_id === 'persona_researcher');
        expect(openalex?.params).toEqual({ search: 'foundation models' });
        expect(memory).toBeTruthy();
        expect(persona).toBeTruthy();

        const wires = useWireStore.getState().getWiresByShell(shellId);
        expect(wires.some(w => w.sourceBlockId === memory!.instance_id && w.targetBlockId === persona!.instance_id)).toBe(true);
        expect(wires.some(w => w.sourceBlockId === openalex!.instance_id && w.targetBlockId === persona!.instance_id)).toBe(true);
    });
});
