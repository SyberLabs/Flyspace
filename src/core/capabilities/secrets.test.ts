import { describe, it, expect, beforeEach } from 'vitest';
import { MAX_SECRET_BYTES, capabilitySecrets, secretByteLength } from './secrets';

beforeEach(() => {
    capabilitySecrets.clear();
});

describe('secret slot bound', () => {
    it(`holds a value of exactly ${MAX_SECRET_BYTES} bytes`, () => {
        const value = 'k'.repeat(MAX_SECRET_BYTES);
        capabilitySecrets.set('slot', value);
        expect(capabilitySecrets.get('slot')).toBe(value);
    });

    it(`refuses a value of ${MAX_SECRET_BYTES + 1} bytes and leaves the slot empty`, () => {
        expect(() => capabilitySecrets.set('slot', 'k'.repeat(MAX_SECRET_BYTES + 1))).toThrow(`at most ${MAX_SECRET_BYTES} bytes`);
        expect(capabilitySecrets.get('slot')).toBeUndefined();
    });

    it('measures UTF-8 bytes, not code units', () => {
        const wide = 'é'.repeat(MAX_SECRET_BYTES / 2 + 1);
        expect(wide.length).toBeLessThan(MAX_SECRET_BYTES);
        expect(secretByteLength(wide)).toBeGreaterThan(MAX_SECRET_BYTES);
        expect(() => capabilitySecrets.set('slot', wide)).toThrow();
    });

    it('still refuses an empty value, as before', () => {
        expect(() => capabilitySecrets.set('slot', '')).toThrow('needs a name and a value');
    });
});
