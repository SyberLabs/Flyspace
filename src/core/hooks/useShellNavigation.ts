// ============================================
// PROJECT OMNI: SHELL NAVIGATION HOOK
// Keyboard shortcuts for quick shell switching
// ============================================

import { useEffect } from 'react';
import { useShellStore, useBlockStore } from '@/core/stores';

/**
 * Hook for keyboard-based shell navigation
 *
 * Supports:
 * - Cmd+0: Navigate to root shell
 * - Cmd+1-9: Navigate to the shell the user assigned to that slot
 *   (unassigned slots fall through to the browser)
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

            // Cmd+1 through Cmd+9 for assigned shell slots
            if (/^[1-9]$/.test(e.key)) {
                const shellId = hotkeySlots[parseInt(e.key, 10)];
                if (shellId) {
                    e.preventDefault();
                    setActiveShell(shellId);
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [hotkeySlots, setActiveShell]);
}
