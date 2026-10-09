import { useBlockStore, BLOCK_INSTANCE_SHAPE } from '../stores/blockStore';
import { useWireStore, DATA_WIRE_SHAPE } from '../stores/wireStore';
import { useShellStore, SHELL_CONFIG_SHAPE, SHELL_BLOCK_SHAPE } from '../stores/shellStore';
import { useMindStore, LLM_CONFIG_SHAPE, GRAPH_SHAPE, PERSONA_SHAPE, CONTEXT_POOL_SHAPE, CONTEXT_ENTRY_SHAPE } from '../stores/mindStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useCapabilityStore } from '../capabilities/store';
import { validateManifest } from '../capabilities/manifest';
import { fieldError, type FieldSpec } from '../vault/hydration';
import type { OmniVaultExport } from '../vault/vaultExport';

const versions: Record<string, number> = { 'omni-blocks': 2, 'omni-wires': 2, 'omni-shells': 1, 'omni-mind': 1, 'omni-settings': 1, 'omni-capabilities': 2 };
const envelope = (state: unknown, version: number) => JSON.stringify({ state, version });
/** Read the live stores, including untouched defaults, as one complete backup. */
export function captureLiveStores(): OmniVaultExport {
    const blocks = useBlockStore.getState(); const wires = useWireStore.getState();
    const shells = useShellStore.getState(); const mind = useMindStore.getState();
    const settings = useSettingsStore.getState(); const capabilities = useCapabilityStore.getState();
    return { format: 'omni-vault-export', version: 1, exportedAt: Date.now(), data: {
        'omni-blocks': envelope({ blocks: blocks.blocks, activeShellId: blocks.activeShellId }, 2),
        'omni-wires': envelope({ wires: wires.wires }, 2),
        'omni-shells': envelope({ shells: shells.shells, activeShellId: shells.activeShellId, hotkeySlots: shells.hotkeySlots, currentPersona: shells.currentPersona, currentAesthetic: shells.currentAesthetic }, 1),
        'omni-mind': envelope({ llmConfig: mind.llmConfig, graph: mind.graph, personas: mind.personas, activePersonaId: mind.activePersonaId, contextPools: mind.contextPools }, 1),
        'omni-settings': envelope({ useMockData: settings.useMockData, gridSnapping: settings.gridSnapping, gridSize: settings.gridSize }, 1),
        'omni-capabilities': envelope({ manifests: capabilities.manifests, stale: capabilities.stale }, 2)
    } };
}
const check = (value: unknown, spec: FieldSpec, path: string) => {
    const error = fieldError(value, spec, path);
    if (error) throw new Error(`Incompatible canvas backup: ${error}`);
};
const records = (values: unknown, spec: FieldSpec, path: string) => {
    check(values, 'array', path);
    for (const value of values as unknown[]) check(value, spec, `${path}[]`);
};
/** Apply the same hydration shapes before any local storage is overwritten. */
export function validateStoreEnvelopes(snapshot: OmniVaultExport): void {
    if (Object.keys(snapshot.data).length !== Object.keys(versions).length || !Number.isFinite(snapshot.exportedAt)) throw new Error('This canvas backup is incomplete.');
    const states: Record<string, Record<string, unknown>> = {};
    for (const [key, version] of Object.entries(versions)) {
        const blob = JSON.parse(snapshot.data[key]);
        check(blob, { version: 'number', state: 'object' }, key);
        if (blob.version !== version) throw new Error('This canvas backup needs a different application version.');
        states[key] = blob.state;
    }
    const blocks = states['omni-blocks']; check(blocks.activeShellId, 'string', 'activeShellId'); records(blocks.blocks, BLOCK_INSTANCE_SHAPE, 'blocks');
    records(states['omni-wires'].wires, DATA_WIRE_SHAPE, 'wires');
    const shells = states['omni-shells'];
    check(shells, { activeShellId: 'string|null', hotkeySlots: 'object', currentPersona: 'string', currentAesthetic: 'string' }, 'shells');
    records(shells.shells, SHELL_CONFIG_SHAPE, 'shells');
    for (const shell of shells.shells as Record<string, unknown>[]) { records(shell.blocks, SHELL_BLOCK_SHAPE, 'shell.blocks'); records(shell.wires, DATA_WIRE_SHAPE, 'shell.wires'); }
    const mind = states['omni-mind'];
    check(mind.llmConfig, LLM_CONFIG_SHAPE, 'llmConfig'); check(mind.graph, GRAPH_SHAPE, 'graph'); check(mind.activePersonaId, 'string|null', 'activePersonaId');
    records(mind.personas, PERSONA_SHAPE, 'personas'); records(mind.contextPools, CONTEXT_POOL_SHAPE, 'contextPools');
    for (const pool of mind.contextPools as Record<string, unknown>[]) records(pool.entries, CONTEXT_ENTRY_SHAPE, 'pool.entries');
    check(states['omni-settings'], { useMockData: 'boolean', gridSnapping: 'boolean', gridSize: 'number' }, 'settings');
    const capabilities = states['omni-capabilities']; check(capabilities.manifests, 'array', 'manifests'); records(capabilities.stale, { id: 'string', title: 'string', reason: 'string', manifest: 'unknown' }, 'stale');
    for (const manifest of capabilities.manifests as unknown[]) if (!validateManifest(manifest).ok) throw new Error('A capability in this backup is invalid.');
}
