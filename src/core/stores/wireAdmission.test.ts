import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { useBlockStore } from './blockStore';
import { useWireStore, admitWire } from './wireStore';
import { useShellStore } from './shellStore';
import { vaultStorage } from '../vault/vaultStorage';
import { blockRegistry } from '../registry/BlockRegistry';
import { SHELL_TEMPLATES } from '../shells/templates';
import { DEFAULT_WIRE_FILTERS, type DataWire } from '../schemas/wire.schema';
import type { BlockInstance, OmniBlockSchema, PortSchema } from '../schemas/block.schema';

// Every path that puts a wire on the canvas runs the same admission as
// wireStore.addWire: storage hydrate, shell restore, and templates.

const jsonOut: PortSchema = { id: 'out', direction: 'output', dataType: 'json' };
const textIn: PortSchema = { id: 'in', direction: 'input', dataType: 'text' };
const anyIn: PortSchema = { id: 'in', direction: 'input', dataType: 'any' };

function schema(id: string, ports: PortSchema[]): OmniBlockSchema {
    return {
        block_id: id,
        display_name: id,
        category: 'workspace',
        semantic_tags: [],
        ports
    };
}

function block(id: string, ports: PortSchema[]): BlockInstance {
    return {
        instance_id: id,
        schema: schema(`test_${id}`, ports),
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

async function writeVault(key: string, state: unknown, version: number): Promise<void> {
    await vaultStorage.setItem(key, JSON.stringify({ state, version }));
}

let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('storage hydrate re-admits wires', () => {
    beforeEach(async () => {
        await writeVault('omni-blocks', {
            blocks: [block('src', [jsonOut]), block('text', [textIn]), block('any', [anyIn])],
            activeShellId: 'root'
        }, 2);
        await writeVault('omni-wires', {
            wires: [wire('w_bad', 'src', 'text'), wire('w_ok', 'src', 'any')]
        }, 2);
    });

    it('drops a stored wire the live canvas would refuse, with one warning', async () => {
        await useBlockStore.persist.rehydrate();
        await useWireStore.persist.rehydrate();

        expect(useWireStore.getState().wires.map(w => w.id)).toEqual(['w_ok']);
        expect(useWireStore.getState().addWire('src', 'text')).toBe('');
        const drops = warn.mock.calls.filter(c => String(c[0]).includes('w_bad'));
        expect(drops).toHaveLength(1);
        expect(String(drops[0][0])).toContain('incompatible-type');
    });

    it('waits for blocks when wires hydrate first', async () => {
        const hydrated = vi.spyOn(useBlockStore.persist, 'hasHydrated').mockReturnValue(false);
        await useWireStore.persist.rehydrate();
        // Blocks not ready: nothing judged yet.
        expect(useWireStore.getState().wires.map(w => w.id)).toEqual(['w_bad', 'w_ok']);

        hydrated.mockRestore();
        await useBlockStore.persist.rehydrate();
        expect(useWireStore.getState().wires.map(w => w.id)).toEqual(['w_ok']);
    });
});

describe('shell restore re-admits wires', () => {
    beforeEach(() => {
        blockRegistry.register(schema('test_restore_src', [jsonOut]));
        blockRegistry.register(schema('test_restore_text', [textIn]));
        blockRegistry.register(schema('test_restore_any', [anyIn]));
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [], lastAdmissionRefusal: null });
    });

    afterEach(() => {
        blockRegistry.unregister('test_restore_src');
        blockRegistry.unregister('test_restore_text');
        blockRegistry.unregister('test_restore_any');
    });

    it('drops a saved wire whose declared port types do not match', () => {
        const now = Date.now();
        const place = { position: { x: 0, y: 0 }, dimensions: { width: 200, height: 120 } };
        useShellStore.setState({
            shells: [{
                id: 'shell_saved',
                type: 'custom',
                name: 'Saved',
                blocks: [
                    { blockId: 'test_restore_src', instanceId: 'r_src', ...place },
                    { blockId: 'test_restore_text', instanceId: 'r_text', ...place },
                    { blockId: 'test_restore_any', instanceId: 'r_any', ...place }
                ],
                wires: [
                    wire('w_bad', 'r_src', 'r_text', 'shell_saved'),
                    wire('w_ok', 'r_src', 'r_any', 'shell_saved')
                ],
                isTemplate: false,
                createdAt: now,
                updatedAt: now,
                lastAccessedAt: now
            }],
            activeShellId: null
        } as never);

        expect(useShellStore.getState().loadShell('shell_saved')).toBe(true);

        const ids = useWireStore.getState().getWiresByShell('shell_saved').map(w => w.id);
        expect(ids).toEqual(['w_ok']);
        const drops = warn.mock.calls.filter(c => String(c[0]).includes('w_bad'));
        expect(drops).toHaveLength(1);
        expect(String(drops[0][0])).toContain('incompatible-type');
        // The saved shell keeps its record; only the active canvas drops the wire.
        const saved = useShellStore.getState().shells.find(s => s.id === 'shell_saved');
        expect(saved?.wires).toHaveLength(2);
    });
});

describe('built-in templates', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [], lastAdmissionRefusal: null });
    });

    it.each(SHELL_TEMPLATES.map(t => [t.id, t] as const))(
        '%s: every template wire passes full admission',
        (_id, template) => {
            const shellId = useShellStore.getState().instantiateTemplate(template)!;
            expect(shellId).toBeTruthy();
            const wires = useWireStore.getState().getWiresByShell(shellId);
            expect(wires).toHaveLength(template.connections.length);
            for (const w of wires) {
                expect(admitWire(w.sourceBlockId, w.targetBlockId)).toMatchObject({ ok: true });
            }
            expect(warn.mock.calls.filter(c => String(c[0]).includes('dropped saved wire'))).toHaveLength(0);
        }
    );
});
