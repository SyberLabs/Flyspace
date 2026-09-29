// Pairs the user asked to keep apart. Wire admission reads this so a
// later drag cannot quietly reconnect them.

const pairs = new Set<string>();

function key(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function markSeparated(a: string, b: string): void {
    pairs.add(key(a, b));
}

export function clearSeparated(a: string, b: string): void {
    pairs.delete(key(a, b));
}

export function isSeparated(a: string, b: string): boolean {
    return pairs.has(key(a, b));
}

export function resetSeparation(): void {
    pairs.clear();
}
