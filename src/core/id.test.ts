import { describe, it, expect, afterEach, vi } from 'vitest';
import { newId } from './id';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a version-4 UUID', () => {
        expect(newId()).toMatch(V4);
    });

    it('does not depend on the clock or Math.random', () => {
        vi.spyOn(Date, 'now').mockReturnValue(0);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        const ids = new Set(Array.from({ length: 10_000 }, () => newId()));
        expect(ids.size).toBe(10_000);
    });

    it('falls back to getRandomValues where randomUUID is absent (insecure browser context)', () => {
        vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(undefined as never);
        Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
        try {
            const ids = new Set(Array.from({ length: 1_000 }, () => newId()));
            expect(ids.size).toBe(1_000);
            for (const id of ids) expect(id).toMatch(V4);
        } finally {
            delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
        }
        expect(typeof globalThis.crypto.randomUUID).toBe('function');
    });
});
