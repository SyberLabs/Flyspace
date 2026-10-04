import { describe, it, expect } from 'vitest';
import { assessEgress, classifyAddress, parseIpv6 } from './egress';

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

    // Every spelling the URL parser can produce must land on the address the
    // socket would reach. These literals name non-public destinations.
    const NON_PUBLIC_LITERALS = [
        '[::ffff:127.0.0.1]',
        '[::ffff:a9fe:a9fe]',
        '[::ffff:0:7f00:1]',
        '[::7f00:1]',
        '[64:ff9b::a9fe:a9fe]',
        '[2002:7f00:1::]',
        '[fec0::1]',
        '[::ffff:10.0.0.1]',
        '[::ffff:c0a8:101]',
        '[::]',
        '[::1]',
        '[fc00::1]',
        '[fe80::1]',
        '[ff02::1]',
        '[2001::1]',
        '[2001:db8::1]',
        '[100::1]'
    ];

    it.each(NON_PUBLIC_LITERALS)('refuses the IPv6 literal %s', (literal) => {
        const url = new URL(`https://${literal}/v1`);
        expect(assessEgress(url, []).ok).toBe(false);
        expect(classifyAddress(url.hostname.slice(1, -1)).ok).toBe(false);
    });

    it('classifies a hex-mapped address by the IPv4 address it carries', () => {
        expect(classifyAddress('::ffff:7f00:1').ok).toBe(false);
        expect(classifyAddress('::ffff:a9fe:a9fe').ok).toBe(false);
        expect(classifyAddress('::ffff:101:101').ok).toBe(true);
        expect(classifyAddress('::ffff:1.1.1.1').ok).toBe(true);
    });

    it('allows a global unicast IPv6 address', () => {
        expect(classifyAddress('2606:4700:4700::1111').ok).toBe(true);
        expect(assessEgress(new URL('https://[2606:4700:4700::1111]/'), []).ok).toBe(true);
        expect(assessEgress(new URL('https://api.example.test/'), [{ address: '2a00:1450:4001::200e' }]).ok).toBe(true);
    });

    it('refuses a name whose resolved IPv6 answer is not global unicast', () => {
        expect(assessEgress(new URL('https://api.example.test/'), [{ address: '64:ff9b::a9fe:a9fe' }]).ok).toBe(false);
        expect(assessEgress(new URL('https://api.example.test/'), [{ address: 'fe80::1%eth0' }]).ok).toBe(false);
    });

    it('parses compressed, dotted, and full spellings to the same groups', () => {
        const expected = [0, 0, 0, 0, 0, 0xffff, 0x7f00, 1];
        expect(parseIpv6('::ffff:127.0.0.1')).toEqual(expected);
        expect(parseIpv6('::ffff:7f00:1')).toEqual(expected);
        expect(parseIpv6('0:0:0:0:0:ffff:7f00:0001')).toEqual(expected);
        expect(parseIpv6('1::2::3')).toBeNull();
        expect(parseIpv6('::ffff:1.2.3.999')).toBeNull();
        expect(parseIpv6('12345::')).toBeNull();
        expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    });

    it('keeps classifying IPv4 literals as before', () => {
        expect(classifyAddress('1.1.1.1').ok).toBe(true);
        expect(classifyAddress('8.8.8.8').ok).toBe(true);
        expect(classifyAddress('172.16.0.1').ok).toBe(false);
        expect(classifyAddress('100.64.0.1').ok).toBe(false);
        expect(classifyAddress('224.0.0.1').ok).toBe(false);
        expect(assessEgress(new URL('https://0x7f.1/'), []).ok).toBe(false);
        expect(assessEgress(new URL('https://2130706433/'), []).ok).toBe(false);
    });
});

describe('IPv4 documentation ranges', () => {
    // The three TEST-NET blocks are /24s (RFC 5737). The rest of their /16s
    // is ordinary public space.
    it.each(['192.0.2.1', '192.0.2.255', '198.51.100.0', '198.51.100.77', '203.0.113.0', '203.0.113.255', '192.0.0.8'])(
        'refuses %s',
        (address) => {
            expect(classifyAddress(address).ok).toBe(false);
        }
    );

    it.each(['192.0.1.1', '192.0.3.0', '198.51.0.1', '198.51.99.255', '198.51.101.0', '203.113.0.1', '203.0.112.255', '203.0.114.0'])(
        'allows public %s',
        (address) => {
            expect(classifyAddress(address).ok).toBe(true);
        }
    );
});
