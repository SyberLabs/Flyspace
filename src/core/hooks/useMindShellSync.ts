// ============================================
// PROJECT OMNI: MIND INIT HOOK
// Brings the Mind store from 'offline' to 'ready' once, at the app root.
// ============================================

import { useEffect } from 'react';
import { useMindStore } from '../stores';

/**
 * Initialize the Mind on mount. Place this at the app root level.
 */
export function useMindShellSync() {
    const mindStatus = useMindStore(state => state.status);
    const initialize = useMindStore(state => state.initialize);

    useEffect(() => {
        if (mindStatus === 'offline') {
            initialize();
        }
    }, [mindStatus, initialize]);
}
