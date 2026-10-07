// ============================================
// PROJECT OMNI: VAULT HEALTH HOOK
// Subscribes a component to the vault's durability state (persistence grant,
// last failed write). Server snapshot is the pre-open state, so SSR and the
// first client render agree.
// ============================================

import { useSyncExternalStore } from 'react';
import { getInitialVaultHealth, getVaultHealth, subscribeVaultHealth, type VaultHealth } from '@/core/vault';

export function useVaultHealth(): VaultHealth {
    return useSyncExternalStore(subscribeVaultHealth, getVaultHealth, getInitialVaultHealth);
}
