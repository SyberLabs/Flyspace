import { describe, it, expect } from 'vitest';
import { dropSettingsClientKeys } from './settingsStore';

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
