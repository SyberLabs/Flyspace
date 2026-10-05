import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { useBlockStore, migrateBlockStore } from './blockStore';
import { vaultStorage, __resetVaultConnection } from '../vault/vaultStorage';
import type { OmniBlockSchema } from '../schemas/block.schema';

const schema: OmniBlockSchema = {
    block_id: 'fred_series',
    display_name: 'FRED Series',
    category: 'truth',
    semantic_tags: [],
};

function addBlock(): string {
    return useBlockStore.getState().addBlock(schema, { x: 0, y: 0 }, 'root');
}

async function waitForPersist(): Promise<void> {
    // persist writes through async IndexedDB; a macrotask is enough for the vault adapter.
    await new Promise(r => setTimeout(r, 30));
}

describe('blockStore.setParams', () => {
    beforeEach(async () => {
        await __resetVaultConnection();
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('merges into existing params rather than replacing them', () => {
        // A later apply (e.g. only the series id) must not wipe siblings like limit.
        const id = addBlock();
        useBlockStore.getState().setParams(id, { seriesId: 'GDP', limit: 24 });
        useBlockStore.getState().setParams(id, { seriesId: 'UNRATE' });

        expect(useBlockStore.getState().getBlock(id)?.params).toEqual({
            seriesId: 'UNRATE',
            limit: 24
        });
    });

    it('persists the merged params on the block', async () => {
        // Reload reads omni-blocks from the vault; without this write, GDP→UNRATE is lost.
        const id = addBlock();
        useBlockStore.getState().setParams(id, { seriesId: 'GDP' });
        useBlockStore.getState().setParams(id, { limit: 12 });
        await waitForPersist();

        const raw = await vaultStorage.getItem('omni-blocks');
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw as string) as {
            state: { blocks: Array<{ instance_id: string; params?: Record<string, unknown> }> };
        };
        const stored = parsed.state.blocks.find(b => b.instance_id === id);
        expect(stored?.params).toEqual({ seriesId: 'GDP', limit: 12 });
    });
});

describe('omni-blocks persist migration v1 → v2', () => {
    it('leaves pre-existing blocks loadable with params undefined', () => {
        // v1 canvases never had params. Inventing defaults here would refetch
        // GDP (etc.) for blocks the user had already aimed in local UI state.
        const v1 = {
            blocks: [{
                instance_id: 'legacy_1',
                schema,
                status: 'disconnected',
                last_updated: null,
                data: null,
                position: { x: 0, y: 0 },
                dimensions: { width: 320, height: 240 },
                shellId: 'root'
            }],
            activeShellId: 'root'
        };

        const migrated = migrateBlockStore(v1, 1);
        const block = (migrated.blocks as Array<{ params?: unknown }>)[0];
        expect(block.params).toBeUndefined();
        expect('params' in block).toBe(false);
    });
});
