// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { migrateCapabilityStore, useCapabilityStore } from './store';
import { installProposal, clearCapabilities, restoreSnapshot, type CapabilitySnapshot } from './registry';
import { readCapability } from './state';
import { compileOpenApi } from './openapi';
import { dropImportedApprovals } from './importAdmission';
import { vaultStorage, __resetVaultConnection } from '../vault/vaultStorage';

/** An MCP manifest as an older build stored it. The transport no longer exists. */
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

describe('omni-capabilities persist migration', () => {
    it('gives state from before `stale` existed an empty list and keeps its manifests', () => {
        const http = compileOpenApi(SPEC).manifests[0];
        expect(migrateCapabilityStore({ manifests: [http] })).toEqual({ manifests: [http], stale: [] });
    });

    it('leaves a v2 state alone', () => {
        const stale = [{ id: 'x', title: 'X', reason: 'r', manifest: {} }];
        expect(migrateCapabilityStore({ manifests: [], stale })).toEqual({ manifests: [], stale });
    });
});

describe('a stored vault record survives rehydrate', () => {
    it('keeps a stored stale entry through later writes until it is forgotten', async () => {
        const stale = [{ id: 'cap_old', title: 'Old', reason: 'r', manifest: {} }];
        await vaultStorage.setItem('omni-capabilities', JSON.stringify({ state: { manifests: [], stale }, version: 2 }));
        await useCapabilityStore.persist.rehydrate();
        expect(useCapabilityStore.getState().stale.map(entry => entry.id)).toEqual(['cap_old']);

        // A later install rewrites the persisted manifests; the stale entry stays.
        expect(installProposal(compileOpenApi(SPEC).manifests[0]).ok).toBe(true);
        await waitForPersist();
        const raw = JSON.parse(await vaultStorage.getItem('omni-capabilities') as string) as {
            version: number;
            state: { manifests: Array<{ id: string }>; stale: Array<{ id: string }> };
        };
        expect(raw.version).toBe(2);
        expect(raw.state.stale.map(entry => entry.id)).toEqual(['cap_old']);
        expect(raw.state.manifests.map(entry => entry.id)).toContain(compileOpenApi(SPEC).manifests[0].id);

        useCapabilityStore.getState().forgetStale('cap_old');
        expect(useCapabilityStore.getState().stale).toEqual([]);
    });

    it('migrates a v1 record on read: a record with no stale list clears the in-memory one', async () => {
        useCapabilityStore.setState({ stale: [{ id: 'x', title: 'X', reason: 'r', manifest: {} }] });
        const http = compileOpenApi(SPEC).manifests[0];
        await vaultStorage.setItem('omni-capabilities', JSON.stringify({ state: { manifests: [http] }, version: 1 }));
        await useCapabilityStore.persist.rehydrate();
        expect(useCapabilityStore.getState().stale).toEqual([]);
    });

    it('restores a stored manifest on first hydration', async () => {
        const http = compileOpenApi(SPEC).manifests[0];
        await vaultStorage.setItem('omni-capabilities', JSON.stringify({ state: { manifests: [http] }, version: 1 }));
        // Hydration is claimed once per page load, so this needs a fresh load.
        vi.resetModules();
        await import('./registry');
        const { readCapability } = await import('./state');
        await vi.waitFor(() => expect(readCapability(http.id)?.digest).toBe(http.digest));
    });

    it('never restores a stored manifest on a transport that no longer exists', () => {
        const report = restoreSnapshot({ version: 1, manifests: [LEGACY_MCP] as never });
        expect(report.installed).toEqual([]);
        expect(report.rejected[0]?.errors.join(' ')).toMatch(/transport\.kind/);
    });

    it('composes with the vault import: an imported v1 blob lands a write pending, approval dropped', async () => {
        // The import rewrites the blob (write entries → pending) but keeps its
        // version, so the persist migration still runs on the next rehydrate.
        const write = compileOpenApi({
            ...SPEC,
            paths: { '/items': { post: { operationId: 'add', responses: { '204': { description: 'added' } } } } }
        }).manifests[0];
        const approved = { ...write, approval: 'approved' as const };
        const imported = dropImportedApprovals(JSON.stringify({ state: { manifests: [approved] }, version: 1 }));
        expect(imported.needsApproval).toEqual([{ id: write.id, title: write.title, effect: 'write' }]);
        const admitted = JSON.parse(imported.blob) as { state: Pick<CapabilitySnapshot, 'manifests'>; version: number };
        expect(admitted.version).toBe(1);

        expect(restoreSnapshot({ version: 1, manifests: admitted.state.manifests }).installed).toEqual([write.id]);
        expect(readCapability(write.id)).toMatchObject({ approval: 'pending', digest: write.digest });
    });
});
