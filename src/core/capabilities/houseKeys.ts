// Which curated manifests this server can answer on its own key
// (src/core/services/server/dataPlant.ts). Read once at startup from
// GET /api/capability-broker: digests and API ids only, never a key. A
// covered manifest runs without the person entering a key; one they enter
// still wins, and the server decides at run time whether its key applies.

import type { CapabilityManifest } from './manifest';

let digests: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(next: Iterable<string>): void {
    digests = new Set(next);
    for (const listener of listeners) listener();
}

/** True when the server said its key covers this exact broker-routed manifest. */
export function houseKeyCovers(manifest: CapabilityManifest | undefined): boolean {
    return !!manifest
        && manifest.transport.kind === 'http'
        && manifest.transport.access === 'server_broker'
        && digests.has(manifest.digest);
}

export function subscribeHouseKeys(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Ask the server what its keys cover. Any failure leaves coverage empty: people enter keys as before. */
export async function loadHouseKeys(fetchImpl: typeof fetch = fetch): Promise<void> {
    try {
        const response = await fetchImpl('/api/capability-broker', { headers: { accept: 'application/json' } });
        if (!response.ok) return;
        const body = await response.json() as { digests?: unknown };
        if (!Array.isArray(body.digests)) return;
        publish(body.digests.filter((digest): digest is string => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)));
    } catch {
        // No server, or no broker: nothing is covered.
    }
}

export function setHouseKeysForTests(next: Iterable<string>): void {
    publish(next);
}
