// An imported vault file is not this store's own persisted state. The
// rehydrate path (`restoreSnapshot`) may keep an approval because the blob it
// reads came from this browser; a file can have come from anywhere, so its
// write and destructive entries land `pending`, exactly as `installProposal`
// leaves a proposal, and the user approves them again. Nothing here
// validates: rehydrate still revalidates every entry, and the digest does not
// cover approval, so this rewrite cannot make a valid entry invalid.

import { sideEffectPending, type CapabilityEffect, type CapabilityManifest } from './manifest';

/** Persisted key of the capability store (`store.ts`). */
export const CAPABILITY_STORE_KEY = 'omni-capabilities';

/** A write or destructive capability that an import left waiting for approval. */
export interface ImportedCapability {
    id: string;
    title: string;
    effect: 'write' | 'destructive';
}

export interface ImportedApprovalReport {
    /** The blob to write: identical to the input unless an entry was reset. */
    blob: string;
    /** Every write or destructive entry in the file, all now `pending`. */
    needsApproval: ImportedCapability[];
}

/**
 * Rewrite the persisted `omni-capabilities` blob so no write or destructive
 * entry carries an approval. A blob that is not the store's envelope is
 * returned unchanged: rehydrate installs nothing from it either.
 */
export function dropImportedApprovals(blob: string): ImportedApprovalReport {
    let parsed: unknown;
    try {
        parsed = JSON.parse(blob);
    } catch {
        return { blob, needsApproval: [] };
    }
    if (!isRecord(parsed) || !isRecord(parsed.state) || !Array.isArray(parsed.state.manifests)) {
        return { blob, needsApproval: [] };
    }

    const needsApproval: ImportedCapability[] = [];
    let changed = false;
    const manifests = parsed.state.manifests.map((entry: unknown) => {
        if (!isSideEffect(entry)) return entry;
        const reset = sideEffectPending(entry);
        if (reset !== entry) changed = true;
        needsApproval.push({
            id: entry.id,
            title: typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : entry.id,
            effect: entry.effect
        });
        return reset;
    });

    if (!changed) return { blob, needsApproval };
    return {
        blob: JSON.stringify({ ...parsed, state: { ...parsed.state, manifests } }),
        needsApproval
    };
}

type SideEffectEntry = Pick<CapabilityManifest, 'effect' | 'approval'> & {
    id: string;
    title?: unknown;
    effect: 'write' | 'destructive';
};

function isSideEffect(entry: unknown): entry is SideEffectEntry {
    if (!isRecord(entry) || typeof entry.id !== 'string') return false;
    const effect = entry.effect as CapabilityEffect | undefined;
    return effect === 'write' || effect === 'destructive';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
