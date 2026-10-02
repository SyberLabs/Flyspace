// A second, independent check of a broker destination, using Node's own
// address parser. `assessEgress` decides; this refuses anything it would
// have missed. It is deliberately not built from the same code.

import { BlockList, isIP } from 'node:net';

const IPV4_NON_PUBLIC: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 3]
];

const IPV6_NON_GLOBAL_EXTRA: Array<[string, number]> = [
    ['2001::', 32],
    ['2001:db8::', 32],
    ['2002::', 16],
    ['3fff::', 20],
    ['4000::', 2],
    ['8000::', 1]
];

/**
 * 0::/3 minus ::ffff:0:0/96, as a list of subnets. Node checks an IPv4
 * address against ::ffff:0:0/96 too, so that prefix is left to the IPv4
 * rules above (which then also cover every mapped spelling).
 */
function lowRangeWithoutMapped(): Array<[string, number]> {
    const ZERO = BigInt(0);
    const ONE = BigInt(1);
    const mappedPrefix = BigInt(0xffff) << BigInt(32); // ::ffff:0:0
    const subnets: Array<[string, number]> = [];
    for (let length = 4; length <= 96; length++) {
        const bit = ONE << BigInt(128 - length);
        const onPath = (mappedPrefix & bit) !== ZERO;
        const parentMask = ((ONE << BigInt(length - 1)) - ONE) << BigInt(129 - length);
        const sibling = (mappedPrefix & parentMask) | (onPath ? ZERO : bit);
        subnets.push([formatV6(sibling), length]);
    }
    return subnets;
}

function formatV6(value: bigint): string {
    const groups: string[] = [];
    for (let i = 7; i >= 0; i--) groups.push(((value >> BigInt(i * 16)) & BigInt(0xffff)).toString(16));
    return groups.join(':');
}

const blockList = new BlockList();
for (const [address, prefix] of IPV4_NON_PUBLIC) blockList.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [...lowRangeWithoutMapped(), ...IPV6_NON_GLOBAL_EXTRA]) {
    blockList.addSubnet(address, prefix, 'ipv6');
}

/** True when the address is not one the broker may connect to. Unparseable is refused. */
export function isBlockedDestination(address: string): boolean {
    try {
        const family = isIP(address);
        if (family === 4) return blockList.check(address, 'ipv4');
        if (family === 6) return blockList.check(address, 'ipv6');
    } catch {
        // A form Node cannot check is a form the broker does not dial.
    }
    return true;
}
