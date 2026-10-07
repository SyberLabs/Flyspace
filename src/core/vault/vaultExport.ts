// ============================================
// PROJECT OMNI: OMNIVAULT — EXPORT / IMPORT (apex A2)
// One-click "your data" portability. The export gathers BOTH storage
// engines — vault (IndexedDB) keys AND legacy `omni-*` localStorage keys —
// so it is complete regardless of which stores have migrated to the vault.
// Import writes each entry to both engines (harmless, guarantees pickup
// wherever the owning store currently reads from), then the caller reloads.
// A file is not this browser's own state: before anything is written, the
// capability blob loses every write/destructive approval it carried
// (`prepareVaultImport`), so an import can never install a pre-approved
// side effect. The rest of the file is written as it came.
// ============================================

import { listVaultKeys, getVaultValue, vaultStorage } from './vaultStorage';
import {
    CAPABILITY_STORE_KEY,
    dropImportedApprovals,
    type ImportedCapability
} from '../capabilities/importAdmission';

export interface OmniVaultExport {
    format: 'omni-vault-export';
    version: 1;
    exportedAt: number;
    /** Raw persisted JSON strings, keyed by store name. */
    data: Record<string, string>;
}

const OMNI_KEY_PREFIX = 'omni-';

/** Gather all persisted app state into a portable export object. */
export async function exportVault(): Promise<OmniVaultExport> {
    const data: Record<string, string> = {};

    // localStorage first (legacy / not-yet-migrated stores)…
    if (typeof localStorage !== 'undefined') {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(OMNI_KEY_PREFIX)) {
                const value = localStorage.getItem(key);
                if (value !== null) data[key] = value;
            }
        }
    }

    // …then the vault (migrated stores win when both hold a copy —
    // the vault is the live engine for them).
    for (const key of await listVaultKeys()) {
        const value = await getVaultValue(key);
        if (value !== null) data[key] = value;
    }

    return {
        format: 'omni-vault-export',
        version: 1,
        exportedAt: Date.now(),
        data
    };
}

/** Validate an untrusted parsed JSON object as an OmniVaultExport. */
export function isVaultExport(obj: unknown): obj is OmniVaultExport {
    if (!obj || typeof obj !== 'object') return false;
    const o = obj as Record<string, unknown>;
    return o.format === 'omni-vault-export'
        && o.version === 1
        && typeof o.data === 'object' && o.data !== null
        && Object.entries(o.data as Record<string, unknown>)
            .every(([k, v]) => k.startsWith(OMNI_KEY_PREFIX) && typeof v === 'string');
}

export interface VaultImportPlan {
    /** What the import will write, keyed like `OmniVaultExport.data`. */
    data: Record<string, string>;
    /** Write and destructive capabilities in the file; each lands `pending`. */
    needsApproval: ImportedCapability[];
}

export interface VaultImportReport {
    /** Number of restored keys. */
    restored: number;
    needsApproval: ImportedCapability[];
}

/**
 * Decide what an import writes, without writing it. The only rewrite is the
 * capability store's blob: an imported write or destructive capability may
 * not carry an approval, so it is reset to `pending` and reported. Pure, so
 * the UI can show the list before the user confirms.
 */
export function prepareVaultImport(exported: OmniVaultExport): VaultImportPlan {
    const data: Record<string, string> = { ...exported.data };
    let needsApproval: ImportedCapability[] = [];
    const capabilities = data[CAPABILITY_STORE_KEY];
    if (typeof capabilities === 'string') {
        const admitted = dropImportedApprovals(capabilities);
        data[CAPABILITY_STORE_KEY] = admitted.blob;
        needsApproval = admitted.needsApproval;
    }
    return { data, needsApproval };
}

/**
 * Restore an export. Writes every entry of `prepareVaultImport` to both
 * engines; the caller should reload the page afterwards so all stores
 * rehydrate from the restored state.
 */
export async function importVault(exported: OmniVaultExport): Promise<VaultImportReport> {
    const plan = prepareVaultImport(exported);
    let restored = 0;
    for (const [key, value] of Object.entries(plan.data)) {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(key, value);
        }
        await vaultStorage.setItem(key, value);
        restored++;
    }
    return { restored, needsApproval: plan.needsApproval };
}
