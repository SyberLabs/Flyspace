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
    const mapped = ipv4FromMapped(address);
    if (mapped) return classifyAddress(mapped);
    if (address.includes(':')) return classifyV6(address);
    return classifyV4(address);
}

function isIpLiteral(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function ipv4FromMapped(address: string): string | null {
    const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    return match ? match[1] : null;
}

function classifyV4(address: string): EgressDecision {
    const parts = address.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return { ok: false, reason: 'address is not a public IPv4 address' };
    }
    const [a, b] = parts;
    const blocked =
        a === 0
        || a === 10
        || a === 127
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 0)
        || (a === 192 && b === 168)
        || (a === 198 && (b === 18 || b === 19))
        || (a === 198 && b === 51)
        || (a === 203 && b === 113)
        || a >= 224;
    return blocked
        ? { ok: false, reason: 'address is not a public IPv4 address' }
        : { ok: true };
}

function classifyV6(address: string): EgressDecision {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return { ok: false, reason: 'address is not a public IPv6 address' };
    const head = lower.split(':')[0];
    const first = Number.parseInt(head || '0', 16);
    if (!Number.isFinite(first)) return { ok: false, reason: 'address is not a public IPv6 address' };
    // fc00::/7 unique local, fe80::/10 link-local, ff00::/8 multicast.
    if ((first & 0xfe00) === 0xfc00) return { ok: false, reason: 'address is not a public IPv6 address' };
    if ((first & 0xffc0) === 0xfe80) return { ok: false, reason: 'address is not a public IPv6 address' };
    if ((first & 0xff00) === 0xff00) return { ok: false, reason: 'address is not a public IPv6 address' };
    return { ok: true };
}
