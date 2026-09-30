// ============================================
// PROJECT OMNI: SHELL NAVIGATION HOOK
// Keyboard shortcuts for quick shell switching
// ============================================

import { useEffect } from 'react';
import { useShellStore, useBlockStore } from '@/core/stores';

/**
 * Default system shell hotkey mapping
 * Cmd+1-7 map to the 7 life system shells
 */
const DEFAULT_SYSTEM_SHORTCUTS: Record<string, string> = {
    '1': 'health',
    '2': 'career',
    '3': 'finance',
    '4': 'mind',
    '5': 'relationships',
    '6': 'environment',
    '7': 'time'
};

/**
 * Hook for keyboard-based shell navigation
 *
 * Supports:
 * - Cmd+0: Navigate to root shell
 * - Cmd+1-9: Navigate to shell slots (custom or default system shells)
 *
 * Priority:
 * 1. Check if user assigned a custom shell to the hotkey slot
 * 2. Fall back to default system shell mapping (Cmd+1-7)
 * 3. Slots 8-9 are user-assignable only
 */
export function useShellNavigation() {
    const { hotkeySlots } = useShellStore();
    const { setActiveShell } = useBlockStore();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only handle Cmd/Ctrl + number keys
            if (!(e.metaKey || e.ctrlKey)) return;

            // Cmd+0 for root/home shell
            if (e.key === '0') {
                e.preventDefault();
                setActiveShell('root');
                return;
            }

            // Cmd+1 through Cmd+9 for shell slots
            if (/^[1-9]$/.test(e.key)) {
                e.preventDefault();
                const slot = parseInt(e.key, 10);

                // Priority 1: Check if user assigned a custom shell to this slot
                const customShellId = hotkeySlots[slot];
                if (customShellId) {
                    setActiveShell(customShellId);
                    // TODO: Add navigation to shell view when shell viewer is implemented
                    return;
                }

                // Priority 2: Fall back to default system shell mapping (slots 1-7 only)
                const systemType = DEFAULT_SYSTEM_SHORTCUTS[e.key];
                if (systemType) {
                    const shellId = `system:${systemType}`;
                    setActiveShell(shellId);
                    return;
                }

                // Slots 8-9 have no default - only respond if user assigned a custom shell
                // (already handled above in customShellId check)
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [hotkeySlots, setActiveShell]);
}
