import { describe, it, expect } from 'vitest';
import { classifyAddress } from '@/core/capabilities/egress';
import { isBlockedDestination } from './egressBlockList';

describe('egress block list', () => {
    it.each([
        '127.0.0.1',
        '10.0.0.1',
        '169.254.169.254',
        '192.168.0.1',
        '::1',
        '::',
        '::ffff:127.0.0.1',
        '::ffff:7f00:1',
        '::ffff:a9fe:a9fe',
        '::ffff:0:7f00:1',
        '::7f00:1',
        '64:ff9b::a9fe:a9fe',
        '2002:7f00:1::',
        '2001::1',
        '2001:db8::1',
        'fec0::1',
        'fc00::1',
        'fe80::1',
        'ff02::1',
        'not-an-address'
    ])('blocks %s', (address) => {
        expect(isBlockedDestination(address)).toBe(true);
    });

    it.each([
        '1.1.1.1',
        '8.8.8.8',
        '::ffff:1.1.1.1',
        '2606:4700:4700::1111',
        '2a00:1450:4001::200e'
    ])('allows %s', (address) => {
        expect(isBlockedDestination(address)).toBe(false);
    });
});

describe('the classifier and the block list agree on IPv4', () => {
    // Every IPv4 range either check refuses, with the addresses on and just
    // outside each edge. The two are built separately and must still agree.
    const RANGES: Array<[string, string]> = [
        ['0.0.0.0', '0.255.255.255'],
        ['10.0.0.0', '10.255.255.255'],
        ['100.64.0.0', '100.127.255.255'],
        ['127.0.0.0', '127.255.255.255'],
        ['169.254.0.0', '169.254.255.255'],
        ['172.16.0.0', '172.31.255.255'],
        ['192.0.0.0', '192.0.0.255'],
        ['192.0.2.0', '192.0.2.255'],
        ['192.168.0.0', '192.168.255.255'],
        ['198.18.0.0', '198.19.255.255'],
        ['198.51.100.0', '198.51.100.255'],
        ['203.0.113.0', '203.0.113.255'],
        ['224.0.0.0', '255.255.255.255']
    ];
    const toInt = (address: string) => address.split('.').reduce((sum, part) => sum * 256 + Number(part), 0);
    const toText = (value: number) => [24, 16, 8, 0].map(shift => Math.floor(value / 2 ** shift) % 256).join('.');
    const samples = new Set<string>(['1.1.1.1', '8.8.8.8', '198.51.0.1', '203.113.0.1', '192.0.1.1']);
    for (const [first, last] of RANGES) {
        const low = toInt(first);
        const high = toInt(last);
        for (const value of [low - 1, low, low + 1, high - 1, high, high + 1]) {
            if (value >= 0 && value <= 0xffffffff) samples.add(toText(value));
        }
    }

    it.each([...samples])('%s', (address) => {
        expect(classifyAddress(address).ok).toBe(!isBlockedDestination(address));
    });
});
