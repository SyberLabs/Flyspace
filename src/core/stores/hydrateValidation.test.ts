import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { useBlockStore } from './blockStore';
import { useWireStore } from './wireStore';
import { useShellStore } from './shellStore';
import { useMindStore } from './mindStore';
import { vaultStorage } from '../vault/vaultStorage';
import { getHydrationRejections, __resetHydrationRejections } from '../vault/hydration';
import { DEFAULT_WIRE_FILTERS, type DataWire } from '../schemas/wire.schema';
import type { BlockInstance, OmniBlockSchema } from '../schemas/block.schema';
import type { ShellConfig } from '../schemas/shell.schema';
import { LLM_DEFAULTS, createInitialMindState } from '../schemas/mind.schema';

// A record read back from the vault is checked against its schema before it
// becomes state. A record that fails is dropped, recorded, and warned about;
// the records next to it survive. Nothing is cast.

const schema: OmniBlockSchema = {
    block_id: 'test_hydrate',
    display_name: 'Hydrate',
    category: 'workspace',
    semantic_tags: []
};

function block(id: string): BlockInstance {
    return {
        instance_id: id,
        schema,
        status: 'disconnected',
        last_updated: null,
        data: null,
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 120 },
        shellId: 'root'
    };
}

function wire(id: string, sourceBlockId: string, targetBlockId: string, shellId = 'root'): DataWire {
    return {
        id,
        sourceBlockId,
        targetBlockId,
        wireType: 'push',
        filters: { ...DEFAULT_WIRE_FILTERS },
        status: 'active',
        shellId
    };
}

function shell(id: string): ShellConfig {
    const now = 1_700_000_000_000;
    return {
        id,
        type: 'custom',
        name: id,
        blocks: [{
            blockId: 'test_hydrate',
            instanceId: `${id}_b1`,
            position: { x: 0, y: 0 },
            dimensions: { width: 200, height: 120 }
        }],
        wires: [],
        persona: 'analyst',
        aesthetic: 'command',
        createdAt: now,
        updatedAt: now
    };
}

async function writeVault(key: string, state: unknown, version?: number): Promise<void> {
    await vaultStorage.setItem(key, JSON.stringify(version === undefined ? { state } : { state, version }));
}

async function readVault(key: string): Promise<{ state: Record<string, unknown>; version?: number }> {
    return JSON.parse((await vaultStorage.getItem(key)) as string);
}

let warn: MockInstance<typeof console.warn>;

beforeEach(async () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    __resetHydrationRejections();
    for (const key of ['omni-blocks', 'omni-wires', 'omni-shells', 'omni-mind']) {
        await vaultStorage.removeItem(key);
    }
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [], lastAdmissionRefusal: null });
    useShellStore.setState({ shells: [], activeShellId: null, hotkeySlots: {} });
    useMindStore.setState(createInitialMindState());
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('omni-blocks hydrate', () => {
    it('drops a block with a missing field, a wrong type, or no block type; keeps the rest', async () => {
        const { position: _noPosition, ...missingPosition } = block('b_missing');
        await writeVault('omni-blocks', {
            blocks: [
                block('b_ok'),
                missingPosition,
                { ...block('b_wrong_type'), schema: { ...schema, block_id: 42 } },
                { ...block('b_no_type'), schema: null },
                'not even an object'
            ],
            activeShellId: 'root'
        }, 2);

        await useBlockStore.persist.rehydrate();

        expect(useBlockStore.getState().blocks.map(b => b.instance_id)).toEqual(['b_ok']);
        const rejected = getHydrationRejections().filter(r => r.store === 'omni-blocks');
        expect(rejected.map(r => r.id)).toEqual(['b_missing', 'b_wrong_type', 'b_no_type', null]);
        expect(rejected[0].reason).toContain('position');
        expect(rejected[1].reason).toContain('schema.block_id');
        expect(rejected[2].reason).toContain('schema');
        expect(warn).toHaveBeenCalledTimes(4);
    });

    it('falls back to the root shell when the persisted active shell is not a string', async () => {
        await writeVault('omni-blocks', { blocks: [block('b_ok')], activeShellId: 7 }, 2);
        await useBlockStore.persist.rehydrate();
        expect(useBlockStore.getState().activeShellId).toBe('root');
        expect(getHydrationRejections().map(r => r.reason).join()).toContain('activeShellId');
    });

    it('rejects a blocks field that is not an array and keeps an empty canvas', async () => {
        await writeVault('omni-blocks', { blocks: { b_ok: block('b_ok') }, activeShellId: 'root' }, 2);
        await useBlockStore.persist.rehydrate();
        expect(useBlockStore.getState().blocks).toEqual([]);
        expect(getHydrationRejections()).toHaveLength(1);
        expect(getHydrationRejections()[0].reason).toContain('array');
    });

    it('hydrates nothing and records nothing when the vault is empty', async () => {
        await useBlockStore.persist.rehydrate();
        expect(useBlockStore.getState().blocks).toEqual([]);
        expect(useBlockStore.getState().activeShellId).toBe('root');
        expect(getHydrationRejections()).toEqual([]);
    });
});

describe('omni-wires hydrate', () => {
    it('drops a malformed wire before admission; a well-formed one is still admitted', async () => {
        await writeVault('omni-blocks', { blocks: [block('src'), block('dst')], activeShellId: 'root' }, 2);
        const { targetBlockId: _noTarget, ...missingTarget } = wire('w_missing', 'src', 'dst');
        await writeVault('omni-wires', {
            wires: [
                wire('w_ok', 'src', 'dst'),
                missingTarget,
                { ...wire('w_filters', 'src', 'dst'), filters: 'yes' }
            ]
        }, 2);

        await useBlockStore.persist.rehydrate();
        await useWireStore.persist.rehydrate();

        expect(useWireStore.getState().wires.map(w => w.id)).toEqual(['w_ok']);
        const rejected = getHydrationRejections().filter(r => r.store === 'omni-wires');
        expect(rejected.map(r => r.id)).toEqual(['w_missing', 'w_filters']);
        expect(rejected[0].reason).toContain('targetBlockId');
        expect(rejected[1].reason).toContain('filters');
    });
});

describe('omni-shells hydrate', () => {
    it('drops a shell missing a required field and a block entry inside a shell that is malformed', async () => {
        const { name: _noName, ...missingName } = shell('s_missing');
        const partlyBroken = shell('s_partly');
        partlyBroken.blocks.push({ blockId: 'test_hydrate', instanceId: 's_partly_bad' } as never);
        partlyBroken.wires.push({ id: 's_partly_w' } as never);
        await writeVault('omni-shells', {
            shells: [shell('s_ok'), missingName, partlyBroken],
            activeShellId: 42,
            hotkeySlots: { 1: 's_ok' },
            currentPersona: 'analyst',
            currentAesthetic: 'command'
        }, 1);

        await useShellStore.persist.rehydrate();

        const state = useShellStore.getState();
        expect(state.shells.map(s => s.id)).toEqual(['s_ok', 's_partly']);
        const partly = state.shells.find(s => s.id === 's_partly') as ShellConfig;
        expect(partly.blocks.map(b => b.instanceId)).toEqual(['s_partly_b1']);
        expect(partly.wires).toEqual([]);
        expect(state.activeShellId).toBeNull();
        expect(state.hotkeySlots).toEqual({ 1: 's_ok' });

        const rejected = getHydrationRejections().filter(r => r.store === 'omni-shells');
        expect(rejected.map(r => r.id)).toEqual(['s_missing', 's_partly_bad', 's_partly_w', null]);
        expect(rejected[0].reason).toContain('name');
        expect(rejected[1].reason).toContain('position');
        expect(rejected[3].reason).toContain('activeShellId');
    });
});

describe('omni-mind hydrate', () => {
    it('is versioned: a v0 blob migrates to v1 with its data carried forward unchanged', async () => {
        const fresh = createInitialMindState();
        const memory = fresh.contextPools.find(p => p.id === 'memory')!;
        const entry = {
            id: 'ctx_1',
            type: 'memory' as const,
            content: 'kept',
            importance: 1,
            timestamp: 1_700_000_000_000,
            sourceBlockId: 'b_1'
        };
        // The store wrote this shape before it had a version (zustand defaults to 0).
        await writeVault('omni-mind', {
            llmConfig: { ...LLM_DEFAULTS.anthropic },
            graph: fresh.graph,
            personas: fresh.personas,
            activePersonaId: 'strategist',
            contextPools: [{ ...memory, entries: [entry] }]
        }, 0);

        await useMindStore.persist.rehydrate();

        const state = useMindStore.getState();
        expect(state.getPoolEntries('memory')).toEqual([entry]);
        expect(state.activePersonaId).toBe('strategist');
        expect(state.llmConfig.provider).toBe('anthropic');
        expect(state.personas.map(p => p.id)).toEqual(fresh.personas.map(p => p.id));
        // Built-in pools the blob lacked are still added.
        expect(state.contextPools.map(p => p.id).sort()).toEqual(fresh.contextPools.map(p => p.id).sort());
        expect(getHydrationRejections()).toEqual([]);

        // Written back at the new version, so the migration runs once.
        await new Promise(r => setTimeout(r, 30));
        expect((await readVault('omni-mind')).version).toBe(1);
    });

    it('drops a malformed pool, a malformed entry, and a malformed persona; falls back for a malformed config', async () => {
        const fresh = createInitialMindState();
        const memory = fresh.contextPools.find(p => p.id === 'memory')!;
        const good = { id: 'ctx_good', type: 'memory', content: 'ok', importance: 0.5, timestamp: 1 };
        const bad = { id: 'ctx_bad', type: 'memory', content: 'no', importance: 'high', timestamp: 1 };
        const { entries: _noEntries, ...poolWithoutEntries } = { ...memory, id: 'custom_pool' };
        await writeVault('omni-mind', {
            llmConfig: { provider: 'anthropic', model: 7, temperature: 0.7, maxTokens: 10 },
            graph: { nodes: 'none' },
            personas: [fresh.personas[0], { id: 'p_bad', name: 'No prompt' }],
            activePersonaId: 'analyst',
            contextPools: [{ ...memory, entries: [good, bad] }, poolWithoutEntries]
        }, 1);

        await useMindStore.persist.rehydrate();

        const state = useMindStore.getState();
        expect(state.getPoolEntries('memory')).toEqual([good]);
        expect(state.contextPools.some(p => p.id === 'custom_pool')).toBe(false);
        expect(state.personas.map(p => p.id)).toEqual([fresh.personas[0].id]);
        expect(state.llmConfig).toEqual(fresh.llmConfig);
        expect(state.graph).toEqual({ nodes: [], edges: [], lastUpdated: state.graph.lastUpdated });

        const rejected = getHydrationRejections().filter(r => r.store === 'omni-mind');
        expect(rejected.map(r => r.id)).toEqual([null, null, 'p_bad', 'custom_pool', 'ctx_bad']);
        expect(rejected[0].reason).toContain('llmConfig');
        expect(rejected[1].reason).toContain('graph');
        expect(rejected[4].reason).toContain('importance');
    });
});
