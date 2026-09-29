// Authoritative installed set. Execution reads this map.
// Registration (gateway, blocks, persistence) lives next to it and is the
// only writer besides restore.

import type { CapabilityManifest } from './manifest';

const installed = new Map<string, CapabilityManifest>();
let hydrated = false;

/** First caller wins. Later vault reads must not clobber a finished restore. */
export function claimHydration(): boolean {
    if (hydrated) return false;
    hydrated = true;
    return true;
}

export function readCapability(id: string): CapabilityManifest | undefined {
    return installed.get(id);
}

export function writeCapability(manifest: CapabilityManifest): void {
    installed.set(manifest.id, manifest);
}

export function deleteCapability(id: string): boolean {
    return installed.delete(id);
}

export function allCapabilities(): CapabilityManifest[] {
    return [...installed.values()];
}

export function capabilityIds(): string[] {
    return [...installed.keys()];
}
