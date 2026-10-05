// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { migrateCapabilityStore, useCapabilityStore } from './store';
import { installProposal, clearCapabilities, listCapabilities } from './registry';
import { compileOpenApi } from './openapi';
import { vaultStorage, __resetVaultConnection } from '../vault/vaultStorage';

/**
 * An MCP manifest as the store persisted it before transport.origin existed.
 * No field in it names the server URL, so an origin cannot be derived.
 */
const LEGACY_MCP = {
    version: 1,
    id: 'cap_legacy_mcp_board_search_0',
    title: 'Search board',
    source: { kind: 'mcp', locator: 'board', operationId: 'search' },
    effect: 'write',
    effectSource: 'declared',
    approval: 'approved',
    invocation: 'manual',
    trigger: { kind: 'manual' },
    auth: { kind: 'none' },
    transport: { kind: 'mcp', serverId: 'board', toolName: 'search' },
    inputs: [],
    output: { schema: { kind: 'array', items: { kind: 'string' } }, presentation: 'raw' },
    digest: 'f'.repeat(64)
};

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Board', version: '1' },
    servers: [{ url: 'https://board.example.test/v1' }],
    paths: {
        '/items': {
            get: { operationId: 'list', responses: { '200': { description: 'items', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } } }
        }
    }
};

async function waitForPersist(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 30));
}

beforeEach(async () => {
    await __resetVaultConnection();
    clearCapabilities();
    useCapabilityStore.setState({ manifests: [], stale: [] });
});

describe('omni-capabilities persist migration v1 → v2', () => {
    it('keeps an origin-less MCP manifest as a stale entry instead of dropping it', () => {
        const http = compileOpenApi(SPEC).manifests[0];
        const migrated = migrateCapabilityStore({ manifests: [LEGACY_MCP, http] }, 1);
        expect(migrated.manifests).toEqual([http]);
        expect(migrated.stale).toEqual([
            expect.objectContaining({ id: LEGACY_MCP.id, title: 'Search board', manifest: LEGACY_MCP })
        ]);
        expect((migrated.stale as Array<{ reason: string }>)[0].reason).toMatch(/origin/);
    });

    it('leaves a v2 state alone', () => {
        const stale = [{ id: 'x', title: 'X', reason: 'r', manifest: {} }];
        expect(migrateCapabilityStore({ manifests: [], stale }, 2)).toEqual({ manifests: [], stale });
    });
});

describe('a v1 vault record survives rehydrate', () => {
    it('surfaces the legacy MCP manifest as stale and persists it through later writes', async () => {
        await vaultStorage.setItem('omni-capabilities', JSON.stringify({ state: { manifests: [LEGACY_MCP] }, version: 1 }));
        await useCapabilityStore.persist.rehydrate();

        expect(useCapabilityStore.getState().stale.map(entry => entry.id)).toEqual([LEGACY_MCP.id]);
        expect(listCapabilities().some(manifest => manifest.id === LEGACY_MCP.id)).toBe(false);

        // A later install rewrites the persisted manifests; the stale entry stays.
        expect(installProposal(compileOpenApi(SPEC).manifests[0]).ok).toBe(true);
        await waitForPersist();
        const raw = JSON.parse(await vaultStorage.getItem('omni-capabilities') as string) as {
            version: number;
            state: { manifests: unknown[]; stale: Array<{ id: string }> };
        };
        expect(raw.version).toBe(2);
        expect(raw.state.stale.map(entry => entry.id)).toEqual([LEGACY_MCP.id]);
        const persistedIds = (raw.state.manifests as Array<{ id: string }>).map(entry => entry.id);
        expect(persistedIds).toContain(compileOpenApi(SPEC).manifests[0].id);
        expect(persistedIds).not.toContain(LEGACY_MCP.id);

        useCapabilityStore.getState().forgetStale(LEGACY_MCP.id);
        expect(useCapabilityStore.getState().stale).toEqual([]);
    });
});
