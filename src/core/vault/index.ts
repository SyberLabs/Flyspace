// ============================================
// PROJECT OMNI: OMNIVAULT (apex A2)
// ============================================

export { vaultStorage, getVaultHealth, getInitialVaultHealth, subscribeVaultHealth } from './vaultStorage';
export type { VaultHealth, VaultFailure } from './vaultStorage';
export { exportVault, importVault, isVaultExport, prepareVaultImport } from './vaultExport';
export type { OmniVaultExport, VaultImportPlan, VaultImportReport } from './vaultExport';
