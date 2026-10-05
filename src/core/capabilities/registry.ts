// Install, approve, persist, and remove capabilities.
// installProposal never honors a side-effect approval that arrived on the
// proposal. approveCapability is the only transition into `approved`.
// restoreSnapshot is the persistence path and may keep an approval the
// user already granted. A vault import is not that path: importAdmission.ts
// resets its write and destructive entries to `pending` before they are
// written.

import { blockRegistry } from '../registry/BlockRegistry';
import type { OmniBlockSchema, PortSchema } from '../schemas/block.schema';
import { useBlockStore } from '../stores/blockStore';
import { wireService } from '../services/wire.service';
import { createOmniError } from '../gateway/omnidata.schema';
import { sideEffectPending, validateManifest, type CapabilityManifest } from './manifest';
import { allCapabilities, capabilityIds, claimHydration, deleteCapability, readCapability, writeCapability } from './state';
import { bindLocalHandler, executeCapability, previewCapabilityRun, type RunPreview } from './execute';
import { clearExecutionLedger } from './executionLedger';
import type { CapabilityResult } from './project';
import { onCapabilityRehydrate, useCapabilityStore } from './store';
import { portDataTypeFor } from './compatibility';
import { resolveWiredInputs } from './wireInputs';
import { runSpeechHandler, speechManifests } from './speech';
import type { ValueType } from './valueType';

export interface InstallResult {
    ok: boolean;
    manifest?: CapabilityManifest;
    errors: string[];
}

export interface CapabilitySnapshot {
    version: 1;
    manifests: CapabilityManifest[];
}

export interface RestoreReport {
    installed: string[];
    rejected: Array<{ id?: string; errors: string[] }>;
}

let persistEnabled = true;

function touch(): void {
    if (!persistEnabled) return;
    useCapabilityStore.setState({ manifests: allCapabilities() });
}

function bindRuntime(manifest: CapabilityManifest): void {
    if (blockRegistry.has(manifest.id)) blockRegistry.unregister(manifest.id);
    blockRegistry.register(toBlockSchema(manifest));
}

function unbindRuntime(id: string, removeInstances: boolean): void {
    blockRegistry.unregister(id);
    if (!removeInstances) return;
    const instances = useBlockStore.getState().blocks.filter(block => block.schema.block_id === id);
    for (const instance of instances) {
        useBlockStore.getState().removeBlock(instance.instance_id);
    }
}

/**
 * Validate a proposal and register it. Write and destructive effects are
 * forced back to `pending` even if the proposal claimed approval.
 */
export function installProposal(proposal: unknown): InstallResult {
    const validated = validateManifest(proposal);
    if (!validated.ok || !validated.manifest) return { ok: false, errors: validated.errors };
    const manifest = sideEffectPending(validated.manifest);
    commit(manifest);
    return { ok: true, manifest, errors: [] };
}

export function approveCapability(id: string): InstallResult {
    const current = readCapability(id);
    if (!current) return { ok: false, errors: ['Capability is not installed'] };
    if (current.effect !== 'write' && current.effect !== 'destructive') {
        return { ok: false, errors: ['Only write and destructive capabilities take approval'] };
    }
    if (current.approval === 'approved') return { ok: true, manifest: current, errors: [] };
    const manifest = { ...current, approval: 'approved' as const };
    commit(manifest);
    return { ok: true, manifest, errors: [] };
}

export function denyCapability(id: string): InstallResult {
    const current = readCapability(id);
    if (!current) return { ok: false, errors: ['Capability is not installed'] };
    if (current.effect !== 'write' && current.effect !== 'destructive') {
        return { ok: false, errors: ['Only write and destructive capabilities take approval'] };
    }
    const manifest = { ...current, approval: 'denied' as const };
    commit(manifest);
    return { ok: true, manifest, errors: [] };
}

export function uninstallCapability(id: string, options?: { removeInstances?: boolean }): boolean {
    if (!readCapability(id)) return false;
    deleteCapability(id);
    unbindRuntime(id, options?.removeInstances !== false);
    touch();
    return true;
}

export function listCapabilities(): CapabilityManifest[] {
    return allCapabilities();
}

export function getCapability(id: string): CapabilityManifest | undefined {
    return readCapability(id);
}

export function exportSnapshot(): CapabilitySnapshot {
    return { version: 1, manifests: allCapabilities() };
}

export function restoreSnapshot(snapshot: unknown): RestoreReport {
    if (!isSnapshot(snapshot)) {
        return { installed: [], rejected: [{ errors: ['snapshot must be { version: 1, manifests }'] }] };
    }
    const accepted: CapabilityManifest[] = [];
    const rejected: RestoreReport['rejected'] = [];
    const seen = new Set<string>();
    for (const entry of snapshot.manifests) {
        const validated = validateManifest(entry);
        const id = isId(entry) ? entry.id : undefined;
        if (!validated.ok || !validated.manifest) {
            rejected.push({ id, errors: validated.errors });
            continue;
        }
        if (seen.has(validated.manifest.id)) {
            rejected.push({ id: validated.manifest.id, errors: ['duplicate id in snapshot'] });
            continue;
        }
        seen.add(validated.manifest.id);
        accepted.push(validated.manifest);
    }

    persistEnabled = false;
    for (const id of capabilityIds()) uninstallCapability(id, { removeInstances: false });
    for (const manifest of accepted) commit(manifest);
    persistEnabled = true;
    touch();
    ensureSpeechCapabilities();
    return { installed: accepted.map(manifest => manifest.id), rejected };
}

export function clearCapabilities(): void {
    clearExecutionLedger();
    for (const id of capabilityIds()) uninstallCapability(id);
}

/** The arguments a run of this block would use: wired values, then block params, then explicit input. */
function runParams(instanceId: string, input?: Record<string, unknown>):
    { capabilityId: string; params: Record<string, unknown> } | { error: CapabilityResult } {
    const block = useBlockStore.getState().getBlock(instanceId);
    const capabilityId = block?.schema.capabilityId;
    if (!block || !capabilityId) {
        const error = { code: 'NOT_INSTALLED', message: 'Block is not a capability', retryable: false };
        return {
            error: {
                ok: false,
                capabilityId: capabilityId ?? '',
                typed: null,
                presentation: createOmniError(capabilityId ?? 'capability', 'custom', error),
                error
            }
        };
    }
    return {
        capabilityId,
        params: {
            ...resolveWiredInputs(instanceId),
            ...(isPlain(block.params) ? block.params : {}),
            ...(input ?? {})
        }
    };
}

/**
 * Describe the request a run of this block would send, without sending it.
 * A write or destructive run needs the returned digest as `confirmedRun`.
 */
export function previewInstalledRun(
    instanceId: string,
    input?: Record<string, unknown>
): { ok: true; preview: RunPreview } | { ok: false; result: CapabilityResult } {
    const resolved = runParams(instanceId, input);
    if ('error' in resolved) return { ok: false, result: resolved.error };
    return previewCapabilityRun(resolved.capabilityId, resolved.params);
}

/** Run an installed capability for a canvas instance and store both values. */
export async function runInstalledCapability(
    instanceId: string,
    input?: Record<string, unknown>,
    options?: { signal?: AbortSignal; idempotencyKey?: string; confirmedRun?: string }
): Promise<CapabilityResult> {
    const resolved = runParams(instanceId, input);
    if ('error' in resolved) return resolved.error;
    const { capabilityId, params } = resolved;
    const result = await executeCapability(capabilityId, params, {
        signal: options?.signal,
        idempotencyKey: options?.idempotencyKey,
        confirmedRun: options?.confirmedRun
    });
    const items = result.presentation.items ?? [];
    useBlockStore.getState().updateData(instanceId, {
        capabilityId,
        typed: result.typed,
        items
    });
    useBlockStore.getState().updateStatus(
        instanceId,
        result.ok ? 'connected' : 'error',
        result.error?.message
    );
    wireService.refreshWiresFromSource(instanceId);
    return result;
}

function commit(manifest: CapabilityManifest): void {
    writeCapability(manifest);
    bindRuntime(manifest);
    const schema = toBlockSchema(manifest);
    useBlockStore.setState(state => ({
        blocks: state.blocks.map(block =>
            block.schema.capabilityId === manifest.id ? { ...block, schema } : block
        )
    }));
    touch();
}

function toBlockSchema(manifest: CapabilityManifest): OmniBlockSchema {
    const output = manifest.output.schema;
    const ports: PortSchema[] = [];
    if (manifest.inputs.length > 0) {
        const inbound = inputSchema(manifest);
        ports.push({
            id: 'in',
            direction: 'input',
            dataType: portDataTypeFor(inbound.kind),
            label: manifest.inputs.length === 1 && manifest.inputs[0].schema.kind === 'string' ? 'Text' : 'Arguments',
            description: 'Capability arguments',
            schema: inbound
        });
    }
    ports.push({
        id: 'out',
        direction: 'output',
        dataType: portDataTypeFor(output.kind),
        label: 'Result',
        description: manifest.description,
        schema: output
    });

    return {
        block_id: manifest.id,
        display_name: manifest.title,
        category: 'system',
        data_type: 'custom',
        refresh_rate: 'manual',
        semantic_tags: ['capability', manifest.source.kind, manifest.effect],
        wiring_logic: 'capability',
        ports,
        icon: iconFor(manifest),
        description: manifest.description ?? `${manifest.effect} capability`,
        isUserCreatable: true,
        capabilityId: manifest.id
    };
}

function iconFor(manifest: CapabilityManifest): string {
    if (manifest.id === 'cap_speech_speak') return 'Volume2';
    if (manifest.id === 'cap_speech_listen') return 'Mic';
    return 'Puzzle';
}

function inputSchema(manifest: CapabilityManifest): ValueType {
    const properties: Record<string, ValueType> = {};
    const required: string[] = [];
    for (const input of manifest.inputs) {
        properties[input.name] = input.schema;
        if (input.required) required.push(input.name);
    }
    return {
        kind: 'object',
        properties,
        ...(required.length > 0 ? { required } : {})
    };
}

function isPlain(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSnapshot(value: unknown): value is CapabilitySnapshot {
    return typeof value === 'object'
        && value !== null
        && (value as CapabilitySnapshot).version === 1
        && Array.isArray((value as CapabilitySnapshot).manifests);
}

function isId(value: unknown): value is { id: string } {
    return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'string';
}

/** Called once, after the vault read. Revalidates before anything is rebound. */
export function acceptRehydrated(manifests: CapabilityManifest[]): void {
    if (!claimHydration()) return;
    // A session that already installed capabilities must not be wiped by an
    // empty vault read that resolves a moment later.
    if (manifests.length === 0 && capabilityIds().length > 0) {
        touch();
        return;
    }
    persistEnabled = false;
    try {
        restoreSnapshot({ version: 1, manifests });
    } finally {
        persistEnabled = true;
    }
}

export function ensureSpeechCapabilities(): void {
    bindLocalHandler('speech.speak', (args, call) => runSpeechHandler('speech.speak', args, call));
    bindLocalHandler('speech.listen', (args, call) => runSpeechHandler('speech.listen', args, call));
    for (const manifest of speechManifests()) {
        const current = readCapability(manifest.id);
        if (current?.digest === manifest.digest) continue;
        installProposal(manifest);
    }
}

onCapabilityRehydrate((manifests) => {
    acceptRehydrated(manifests);
    ensureSpeechCapabilities();
});

ensureSpeechCapabilities();
