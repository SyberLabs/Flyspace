// Egress policy for the server fetch broker.
// A manifest may name a public HTTPS origin. It may not aim the server at
// loopback, link-local, private, or metadata addresses. One private answer
// from DNS rejects the name: a mixed result is how rebinding hides.

export interface ResolvedAddress {
    address: string;
}

export type EgressDecision = { ok: true } | { ok: false; reason: string };

const BLOCKED_HOSTS = new Set([
    'localhost',
    'metadata.google.internal',
    'metadata.google.com'
]);

export function assessEgress(url: URL, addresses: ResolvedAddress[]): EgressDecision {
    if (url.protocol !== 'https:') return { ok: false, reason: 'broker fetches require https' };
    if (url.username || url.password) return { ok: false, reason: 'broker URLs cannot embed credentials' };

    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (BLOCKED_HOSTS.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
        return { ok: false, reason: 'broker host is not a public origin' };
    }
    if (isIpLiteral(host)) {
        return classifyAddress(host).ok ? { ok: true } : { ok: false, reason: 'broker host is not a public address' };
    }
    if (addresses.length === 0) return { ok: false, reason: 'broker host did not resolve' };
    for (const entry of addresses) {
        const decision = classifyAddress(entry.address);
        if (!decision.ok) return { ok: false, reason: 'broker host resolved to a non-public address' };
    }
    return { ok: true };
}

export function classifyAddress(address: string): EgressDecision {
    if (!address.includes(':')) return classifyV4(address);
    const hextets = parseIpv6(address);
    if (!hextets) return { ok: false, reason: 'address is not a public IPv6 address' };
    const mapped = embeddedMappedIpv4(hextets);
    if (mapped) return classifyV4(mapped);
    return classifyV6(hextets);
}

/** 127.0.0.0/8 or ::1, in any spelling, including an IPv4-mapped one. */
export function isLoopbackAddress(address: string): boolean {
    if (!address.includes(':')) return /^127(\.\d{1,3}){3}$/.test(address);
    const hextets = parseIpv6(address);
    if (!hextets) return false;
    const mapped = embeddedMappedIpv4(hextets);
    if (mapped) return mapped.startsWith('127.');
    return hextets.slice(0, 7).every(group => group === 0) && hextets[7] === 1;
}

export function isIpLiteral(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

/**
 * Eight 16-bit groups, or null. Accepts `::` compression, a trailing dotted
 * IPv4 tail, and a zone suffix (dropped). The URL parser rewrites a dotted
 * tail to hex, so both spellings must reach the same value.
 */
export function parseIpv6(address: string): number[] | null {
    const text = address.toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    if (!/^[0-9a-f:.]+$/.test(text)) return null;
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const parse = (part: string): number[] | null => {
        if (part === '') return [];
        const groups: number[] = [];
        const pieces = part.split(':');
        for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i];
            if (piece.includes('.')) {
                if (i !== pieces.length - 1) return null;
                const v4 = dottedQuad(piece);
                if (!v4) return null;
                groups.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
                continue;
            }
            if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
            groups.push(Number.parseInt(piece, 16));
        }
        return groups;
    };
    const head = parse(halves[0]);
    const tail = halves.length === 2 ? parse(halves[1]) : [];
    if (!head || !tail) return null;
    if (halves.length === 1) return head.length === 8 ? head : null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function dottedQuad(text: string): number[] | null {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return null;
    const parts = text.split('.').map(Number);
    return parts.every(part => part <= 255) ? parts : null;
}

/** `::ffff:a.b.c.d` in any spelling: the socket would reach that IPv4 address. */
function embeddedMappedIpv4(h: number[]): string | null {
    if (h[0] || h[1] || h[2] || h[3] || h[4] || h[5] !== 0xffff) return null;
    return [h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff].join('.');
}

function classifyV4(address: string): EgressDecision {
    const parts = address.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return { ok: false, reason: 'address is not a public IPv4 address' };
    }
    const [a, b, c] = parts;
    const blocked =
        a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        // 192.0.0.0/24 (protocol assignments) and the three TEST-NET /24s.
        || (a === 192 && b === 0 && (c === 0 || c === 2))
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51 && c === 100)
        || (a === 203 && b === 0 && c === 113)
        || a >= 224;
    return blocked
        ? { ok: false, reason: 'address is not a public IPv4 address' }
        : { ok: true };
}

/**
 * Only global unicast (2000::/3) is public. That excludes, among others,
 * ::/96 (IPv4-compatible), the ::ffff:0:0:0/96 translated form, 64:ff9b::/96
 * (NAT64), fc00::/7, fe80::/10, fec0::/10 and ff00::/8. Inside 2000::/3,
 * 2002::/16 (6to4) and 2001::/32 (Teredo) embed an IPv4 address, and
 * 2001:db8::/32 and 3fff::/20 are documentation.
 */
function classifyV6(h: number[]): EgressDecision {
    const refused = { ok: false as const, reason: 'address is not a public IPv6 address' };
    if ((h[0] & 0xe000) !== 0x2000) return refused;
    if (h[0] === 0x2002) return refused;
    if (h[0] === 0x2001 && (h[1] === 0 || h[1] === 0x0db8)) return refused;
    if (h[0] === 0x3fff && (h[1] & 0xf000) === 0) return refused;
    return { ok: true };
}
