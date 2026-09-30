// ============================================
// PROJECT OMNI: SETTINGS STORE
// User preferences. Stays on localStorage: small, synchronous, and holds
// nothing sensitive — provider keys are server-side.
// ============================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { OmniSettings } from '../schemas/shell.schema';

interface SettingsState extends OmniSettings {
    updateSetting: <K extends keyof OmniSettings>(key: K, value: OmniSettings[K]) => void;
    toggleMockData: () => void;
}

/** Drop leftover client key slots from older persisted settings. */
export function dropSettingsClientKeys(persisted: unknown): unknown {
    if (!persisted || typeof persisted !== 'object') return persisted;
    const next = { ...(persisted as Record<string, unknown>) };
    delete next.apiKeys;
    return next;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            useMockData: true,
            gridSnapping: true,
            gridSize: 20,

            updateSetting: (key, value) => set({ [key]: value }),

            toggleMockData: () => set(state => ({ useMockData: !state.useMockData }))
        }),
        {
            name: 'omni-settings',
            version: 1,
            migrate: (persisted) => dropSettingsClientKeys(persisted),
            storage: createJSONStorage(() => localStorage)
        }
    )
);
