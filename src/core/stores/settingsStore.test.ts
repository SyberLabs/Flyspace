import { describe, it, expect } from 'vitest';
import { dropSettingsClientKeys, useSettingsStore } from './settingsStore';

describe('dropSettingsClientKeys', () => {
    it('removes the dead apiKeys bag without touching other prefs', () => {
        const persisted = {
            useMockData: false,
            apiKeys: { newsapi: 'should-not-keep' },
            gridSize: 24
        };
        const next = dropSettingsClientKeys(persisted) as Record<string, unknown>;
        expect(next).not.toHaveProperty('apiKeys');
        expect(next.useMockData).toBe(false);
        expect(next.gridSize).toBe(24);
    });
});

describe('settings defaults', () => {
    it('does not fast-poll live upstreams (5–60 s) unless the user opts in', () => {
        expect(useSettingsStore.getState().useMockData).toBe(false);
    });
});
