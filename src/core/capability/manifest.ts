// ============================================
// WP-OMNI-02 — capability manifests.
// A manifest describes an operation. It does not place blocks and it
// does not carry secrets. Write and destructive effects stay proposed
// until an explicit approval.
// ============================================

import type { PortDataType } from '@/core/schemas/block.schema';

export type CapabilityEffect = 'read' | 'write' | 'destructive';
export type CapabilityStatus = 'proposed' | 'approved' | 'denied';

export interface CapabilityPort {
    name: string;
    dataType: PortDataType;
    required?: boolean;
}

export interface CapabilityManifest {
    id: string;
    name: string;
    origin: string;
    operation: string;
    effect: CapabilityEffect;
    inputs: CapabilityPort[];
    outputs: CapabilityPort[];
    status: CapabilityStatus;
}

export interface CapabilityDraft {
    name: string;
    origin: string;
    operation: string;
    effect: CapabilityEffect;
    inputs?: CapabilityPort[];
    outputs?: CapabilityPort[];
}

const manifests = new Map<string, CapabilityManifest>();
const secrets = new Map<string, string>();

function capabilityId(origin: string, operation: string): string {
    return `cap_${origin.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}__${operation.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`;
}

export function resetCapabilities(): void {
    manifests.clear();
    secrets.clear();
}

/** The only registration gate. Reads are approved here. Writes are not. */
export function installProposal(draft: CapabilityDraft): CapabilityManifest {
    const manifest: CapabilityManifest = {
        id: capabilityId(draft.origin, draft.operation),
        name: draft.name,
        origin: draft.origin,
        operation: draft.operation,
        effect: draft.effect,
        inputs: draft.inputs ?? [],
        outputs: draft.outputs ?? [],
        status: draft.effect === 'read' ? 'approved' : 'proposed'
    };
    manifests.set(manifest.id, manifest);
    return { ...manifest, inputs: [...manifest.inputs], outputs: [...manifest.outputs] };
}

export function approveCapability(id: string): CapabilityManifest {
    const current = manifests.get(id);
    if (!current) throw new Error(`Unknown capability: ${id}`);
    if (current.status === 'denied') throw new Error(`Capability ${id} was denied`);
    const next = { ...current, status: 'approved' as const };
    manifests.set(id, next);
    return { ...next };
}

export function denyCapability(id: string): void {
    const current = manifests.get(id);
    if (!current) throw new Error(`Unknown capability: ${id}`);
    manifests.set(id, { ...current, status: 'denied' });
    secrets.delete(id);
}

/** Session slot. Never copied onto the manifest. */
export function setCapabilitySecret(id: string, secret: string): void {
    if (!manifests.has(id)) throw new Error(`Unknown capability: ${id}`);
    secrets.set(id, secret);
}

export function listManifests(): CapabilityManifest[] {
    return [...manifests.values()].map(manifest => ({
        ...manifest,
        inputs: [...manifest.inputs],
        outputs: [...manifest.outputs]
    }));
}

export interface CapabilityResult {
    capabilityId: string;
    output: Record<string, unknown>;
}

/**
 * Run an approved capability. Placement is not this function's job.
 * The handler receives the secret only as an argument, and the returned
 * output is scanned so a handler cannot echo it.
 */
export function executeCapability(
    id: string,
    input: Record<string, unknown>,
    handler: (input: Record<string, unknown>, secret: string | undefined) => Record<string, unknown>
): CapabilityResult {
    const manifest = manifests.get(id);
    if (!manifest) throw new Error(`Unknown capability: ${id}`);
    if (manifest.status !== 'approved') {
        throw new Error(`Capability ${id} is ${manifest.status}; execution requires approval`);
    }
    for (const port of manifest.inputs) {
        if (port.required && (input[port.name] === undefined || input[port.name] === '')) {
            throw new Error(`Missing required input: ${port.name}`);
        }
    }
    const output = handler(input, secrets.get(id));
    const secret = secrets.get(id);
    if (secret && JSON.stringify(output).includes(secret)) {
        throw new Error('Capability output leaked a session secret');
    }
    return { capabilityId: id, output };
}
