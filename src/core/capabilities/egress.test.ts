import { describe, it, expect } from 'vitest';
import { assessEgress, classifyAddress } from './egress';

describe('egress policy', () => {
    it('allows a public https host whose addresses are public', () => {
        const decision = assessEgress(new URL('https://api.example.test/v1'), [{ address: '1.1.1.1' }]);
        expect(decision.ok).toBe(true);
    });

    it('rejects loopback, link-local, private, and metadata targets', () => {
        expect(classifyAddress('127.0.0.1').ok).toBe(false);
        expect(classifyAddress('10.1.2.3').ok).toBe(false);
        expect(classifyAddress('169.254.169.254').ok).toBe(false);
        expect(classifyAddress('192.168.1.9').ok).toBe(false);
        expect(classifyAddress('::1').ok).toBe(false);
        expect(classifyAddress('::ffff:127.0.0.1').ok).toBe(false);
        expect(assessEgress(new URL('https://metadata.google.internal/'), [{ address: '1.1.1.1' }]).ok).toBe(false);
        expect(assessEgress(new URL('http://api.example.test/'), [{ address: '1.1.1.1' }]).ok).toBe(false);
    });

    it('rejects a name when any resolved address is private', () => {
        const decision = assessEgress(new URL('https://api.example.test/v1'), [
            { address: '1.1.1.1' },
            { address: '10.0.0.4' }
        ]);
        expect(decision.ok).toBe(false);
    });
});
