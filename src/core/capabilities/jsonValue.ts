// One argument value, copied into the JSON domain once.
// A run's confirmation digest is computed from this copy and the transport
// receives this same copy, so what a person confirmed and what is sent
// cannot differ. A value JSON cannot carry exactly is refused, not coerced:
// JSON.stringify drops an undefined property and writes NaN as null, so two
// different values would otherwise share one confirmation.

const MAX_DEPTH = 64;

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * A deep, frozen copy of `value` made only of strings, finite numbers,
 * booleans, null, dense arrays and plain objects. -0 becomes 0, which is how
 * every JSON encoder writes it. Anything else is an error naming the path.
 */
export function toJsonValue(value: unknown, path: string): { value: JsonValue } | { error: string } {
    return copy(value, path, 0, new Set());
}

function copy(value: unknown, path: string, depth: number, ancestors: Set<object>): { value: JsonValue } | { error: string } {
    if (depth > MAX_DEPTH) return { error: `${path} is nested more than ${MAX_DEPTH} levels deep` };
    switch (typeof value) {
        case 'string':
        case 'boolean':
            return { value };
        case 'number':
            if (!Number.isFinite(value)) return { error: `${path} is not a finite number` };
            return { value: value === 0 ? 0 : value };
        case 'undefined':
            return { error: `${path} is undefined, which JSON cannot carry` };
        case 'bigint':
        case 'function':
        case 'symbol':
            return { error: `${path} is a ${typeof value}, which JSON cannot carry` };
    }
    if (value === null) return { value: null };
    const object = value as object;
    if (ancestors.has(object)) return { error: `${path} contains itself` };
    ancestors.add(object);
    try {
        return Array.isArray(object)
            ? copyArray(object, path, depth, ancestors)
            : copyObject(object, path, depth, ancestors);
    } finally {
        ancestors.delete(object);
    }
}

function copyArray(list: unknown[], path: string, depth: number, ancestors: Set<object>): { value: JsonValue } | { error: string } {
    if (Object.getPrototypeOf(list) !== Array.prototype) return { error: `${path} is not a plain array` };
    const length = list.length;
    for (const key of Reflect.ownKeys(list)) {
        if (key === 'length') continue;
        // Only a canonical index 0..length-1 is an element; '-1', '0.5' and
        // 'NaN' are properties JSON would drop.
        const index = typeof key === 'string' ? Number(key) : Number.NaN;
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
            return { error: `${path} has a property that is not an element` };
        }
    }
    const out: JsonValue[] = [];
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(list, String(index));
        if (!descriptor) return { error: `${path} is a sparse array` };
        if (!('value' in descriptor)) return { error: `${path}[${index}] is an accessor` };
        const entry = copy(descriptor.value, `${path}[${index}]`, depth + 1, ancestors);
        if ('error' in entry) return entry;
        out.push(entry.value);
    }
    return { value: Object.freeze(out) };
}

function copyObject(object: object, path: string, depth: number, ancestors: Set<object>): { value: JsonValue } | { error: string } {
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) return { error: `${path} is not a plain object` };
    const entries: Array<[string, unknown]> = [];
    for (const key of Reflect.ownKeys(object)) {
        if (typeof key === 'symbol') return { error: `${path} has a symbol key` };
        // Assigning this key to an ordinary object sets its prototype instead
        // of storing it, so a receiver could see something other than this.
        if (key === '__proto__') return { error: `${path}.__proto__ is not an allowed key` };
        const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
        if (!('value' in descriptor)) return { error: `${path}.${key} is an accessor` };
        if (!descriptor.enumerable) return { error: `${path}.${key} is not enumerable` };
        entries.push([key, descriptor.value]);
    }
    if (typeof (object as { toJSON?: unknown }).toJSON === 'function') {
        return { error: `${path} has a toJSON method` };
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, raw] of entries) {
        const entry = copy(raw, `${path}.${key}`, depth + 1, ancestors);
        if ('error' in entry) return entry;
        out[key] = entry.value;
    }
    return { value: Object.freeze(out) };
}
