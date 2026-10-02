import { describe, it, expect } from 'vitest';
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
