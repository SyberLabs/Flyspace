// ============================================
// PROJECT OMNI: OMNIVAULT — HYDRATION ADMISSION
// A record read back from the vault is checked against its schema before it
// becomes state. Until this existed every store hydrated by casting: a blob
// that lost a field, or carried a value of the wrong type, became live state
// and failed later, far from the cause. Now a record that does not fit is
// dropped and recorded here, and the records next to it survive.
//
// The schema source of truth is the TypeScript interface. `Shape<T>` makes
// a spec list every required key of `T`, so adding a required field to an
// interface without updating its shape is a type error, not a silent gap.
// Union members are checked as their primitive (a `status` is a string): the
// unions have no runtime form, and a cosmetic value is not worth a record.
// ============================================

/** One persisted record the hydrate refused, and why. */
export interface HydrationRejection {
    /** The persist name of the store the record came from (`omni-blocks`...). */
    store: string;
    /** The record's own id when it had one. */
    id: string | null;
    /** The first field that failed, and how. */
    reason: string;
    at: number;
}

const rejections: HydrationRejection[] = [];

/** Every record refused since the page loaded. */
export function getHydrationRejections(): readonly HydrationRejection[] {
    return rejections;
}

/** Test hook. */
export function __resetHydrationRejections(): void {
    rejections.length = 0;
}

function recordRejection(store: string, id: string | null, reason: string): void {
    rejections.push({ store, id, reason, at: Date.now() });
    console.warn(`[vault] ${store}: dropped persisted record${id ? ` ${id}` : ''}: ${reason}`);
}

/**
 * What one field must be: a `|`-joined list of `typeof` names plus `array`,
 * `object` (non-null, non-array) and `null`; a list of allowed literals; or
 * a nested shape.
 */
export type FieldSpec = string | readonly string[] | ShapeSpec;
export interface ShapeSpec {
    readonly [field: string]: FieldSpec;
}

/** The spec for `T`: one entry per required key. Optional keys are not checked. */
export type Shape<T> = {
    readonly [K in keyof T as undefined extends T[K] ? never : K]: FieldSpec;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

function matchesPrimitive(value: unknown, spec: string): boolean {
    return spec.split('|').some(kind => {
        switch (kind) {
            case 'unknown': return true;
            case 'null': return value === null;
            case 'array': return Array.isArray(value);
            case 'object': return isRecord(value);
            default: return typeof value === kind;
        }
    });
}

/** The first way `value` fails `spec`, as `path: expected X, got Y`; null when it fits. */
export function fieldError(value: unknown, spec: FieldSpec, path: string): string | null {
    if (typeof spec === 'string') {
        return matchesPrimitive(value, spec) ? null : `${path}: expected ${spec}, got ${describe(value)}`;
    }
    if (Array.isArray(spec)) {
        const allowed = spec as readonly string[];
        return allowed.includes(value as string)
            ? null
            : `${path}: expected one of ${allowed.join('|')}, got ${JSON.stringify(value)}`;
    }
    if (!isRecord(value)) return `${path}: expected object, got ${describe(value)}`;
    for (const [field, nested] of Object.entries(spec as ShapeSpec)) {
        const error = fieldError(value[field], nested, `${path}.${field}`);
        if (error) return error;
    }
    return null;
}

function idOf(value: unknown): string | null {
    if (!isRecord(value)) return null;
    const id = value.id ?? value.instance_id ?? value.instanceId;
    return typeof id === 'string' ? id : null;
}

/**
 * Admit one field of a persisted blob. Returns the value when it fits `spec`.
 * An absent field is simply absent. A present value that does not fit is
 * recorded and dropped, and the caller falls back to its fresh default.
 */
export function admitField<T>(store: string, blob: Record<string, unknown>, field: string, spec: FieldSpec): T | undefined {
    const value = blob[field];
    if (value === undefined) return undefined;
    const error = fieldError(value, spec, field);
    if (error === null) return value as T;
    recordRejection(store, null, error);
    return undefined;
}

/**
 * Admit a persisted list. A value that is not an array is one rejection and
 * yields an empty list; each element that does not fit `shape` is its own
 * rejection and is left out.
 */
export function admitRecords<T>(store: string, field: string, values: unknown, shape: Shape<T>): T[] {
    if (!Array.isArray(values)) {
        if (values !== undefined) recordRejection(store, null, `${field}: expected array, got ${describe(values)}`);
        return [];
    }
    return values.flatMap(value => {
        if (!isRecord(value)) {
            recordRejection(store, null, `${field}[]: expected object, got ${describe(value)}`);
            return [];
        }
        for (const [key, spec] of Object.entries(shape as ShapeSpec)) {
            const error = fieldError(value[key], spec, key);
            if (error) {
                recordRejection(store, idOf(value), error);
                return [];
            }
        }
        return [value as T];
    });
}
