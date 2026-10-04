// Schema-bearing value types for capability ports and manifests.
// This is a closed JSON-Schema subset OMNI can validate without a parser
// dependency. It is the native contract. OmniData is a separate projection.

export const VALUE_KINDS = [
    'string',
    'number',
    'integer',
    'boolean',
    'null',
    'object',
    'array',
    'any'
] as const;

export type ValueKind = (typeof VALUE_KINDS)[number];

export type Primitive = string | number | boolean | null;

export interface ValueType {
    kind: ValueKind;
    description?: string;
    enum?: Primitive[];
    properties?: Record<string, ValueType>;
    required?: string[];
    items?: ValueType;
    /** false rejects unknown keys. A schema types them. Omitted means allow. */
    additionalProperties?: boolean | ValueType;
    format?: string;
    nullable?: boolean;
}

const MAX_SCHEMA_DEPTH = 32;
const MAX_PROPERTIES = 80;
const MAX_DESCRIPTION = 2000;
const SCHEMA_KEYS = new Set([
    'kind', 'description', 'enum', 'properties', 'required', 'items',
    'additionalProperties', 'format', 'nullable'
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An own property of a schema map. A name Object.prototype defines is not one. */
function own<T>(record: Record<string, T> | undefined, name: string): T | undefined {
    return record !== undefined && Object.hasOwn(record, name) ? record[name] : undefined;
}

function isPrimitive(value: unknown): value is Primitive {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function kindMatchesEnum(kind: ValueKind, value: Primitive): boolean {
    if (kind === 'any') return true;
    if (kind === 'integer') return typeof value === 'number' && Number.isInteger(value);
    if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (kind === 'null') return value === null;
    return typeof value === kind;
}

/** Structural check that a candidate is a ValueType we are willing to trust. */
export function validateValueType(schema: unknown, path = 'schema', depth = 0): string[] {
    if (depth > MAX_SCHEMA_DEPTH) return [`${path} exceeds max schema depth`];
    if (!isRecord(schema)) return [`${path} must be an object`];

    for (const key of Object.keys(schema)) {
        if (!SCHEMA_KEYS.has(key)) return [`${path}.${key} is not a value-type field`];
    }

    const kind = schema.kind;
    if (typeof kind !== 'string' || !(VALUE_KINDS as readonly string[]).includes(kind)) {
        return [`${path}.kind is not a supported value type`];
    }

    const errors: string[] = [];
    if (schema.description !== undefined && (typeof schema.description !== 'string' || schema.description.length > MAX_DESCRIPTION)) {
        errors.push(`${path}.description must be a short string`);
    }
    if (schema.format !== undefined && (typeof schema.format !== 'string' || schema.format.length > 64)) {
        errors.push(`${path}.format must be a short string`);
    }
    if (schema.nullable !== undefined && typeof schema.nullable !== 'boolean') {
        errors.push(`${path}.nullable must be boolean`);
    }

    if (schema.enum !== undefined) {
        if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 64) {
            errors.push(`${path}.enum must be a non-empty list of primitives`);
        } else if (schema.enum.some(entry => !isPrimitive(entry) || !kindMatchesEnum(kind as ValueKind, entry))) {
            errors.push(`${path}.enum values must match kind ${kind}`);
        } else if (schema.enum.some(entry => typeof entry === 'number' && (!Number.isFinite(entry) || Object.is(entry, -0)))) {
            // The digest writes these as null and 0, so they would hash as another enum.
            errors.push(`${path}.enum numbers must be finite and not -0`);
        }
    }

    if (kind !== 'object' && (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined)) {
        errors.push(`${path} carries object keywords but kind is ${kind}`);
    }
    if (kind !== 'array' && schema.items !== undefined) {
        errors.push(`${path} carries items but kind is ${kind}`);
    }

    if (kind === 'object') {
        if (schema.properties !== undefined) {
            if (!isRecord(schema.properties)) {
                errors.push(`${path}.properties must be an object`);
            } else {
                const names = Object.keys(schema.properties);
                if (names.length > MAX_PROPERTIES) errors.push(`${path}.properties exceeds ${MAX_PROPERTIES}`);
                for (const name of names) {
                    if (!/^[$A-Za-z_][A-Za-z0-9_$.-]{0,80}$/.test(name)) {
                        errors.push(`${path}.properties.${name} has an unsupported name`);
                    }
                    errors.push(...validateValueType(schema.properties[name], `${path}.properties.${name}`, depth + 1));
                }
            }
        }
        if (schema.required !== undefined) {
            if (!Array.isArray(schema.required) || schema.required.some(name => typeof name !== 'string')) {
                errors.push(`${path}.required must be a list of names`);
            } else if (isRecord(schema.properties)) {
                for (const name of schema.required) {
                    if (!Object.hasOwn(schema.properties, name)) {
                        errors.push(`${path}.required names missing property ${name}`);
                    }
                }
            }
        }
        if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') {
            errors.push(...validateValueType(schema.additionalProperties, `${path}.additionalProperties`, depth + 1));
        }
    }

    if (kind === 'array' && schema.items !== undefined) {
        errors.push(...validateValueType(schema.items, `${path}.items`, depth + 1));
    }

    return errors;
}

function typeOf(value: unknown, schema: ValueType): boolean {
    if (value === null) return schema.kind === 'null' || schema.nullable === true || schema.kind === 'any';
    switch (schema.kind) {
        case 'any':
            return true;
        case 'string':
            return typeof value === 'string';
        case 'boolean':
            return typeof value === 'boolean';
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'number':
            return typeof value === 'number' && Number.isFinite(value);
        case 'null':
            return false;
        case 'array':
            return Array.isArray(value);
        case 'object':
            return isRecord(value);
        default:
            return false;
    }
}

/** Deterministic value check. Empty list means the value matches. */
export function validateValue(schema: ValueType, value: unknown, path = 'value', depth = 0): string[] {
    if (depth > MAX_SCHEMA_DEPTH) return [`${path} exceeds max value depth`];
    if (!typeOf(value, schema)) return [`${path} is not ${schema.kind}`];
    if (value === null) return [];

    const errors: string[] = [];
    if (schema.enum && !schema.enum.some(entry => Object.is(entry, value))) {
        errors.push(`${path} is not in the declared enum`);
    }

    if (schema.kind === 'object' && isRecord(value)) {
        const properties = schema.properties ?? {};
        for (const name of schema.required ?? []) {
            if (!Object.hasOwn(value, name) || value[name] === undefined) errors.push(`${path}.${name} is required`);
        }
        for (const [name, child] of Object.entries(value)) {
            if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
                errors.push(`${path}.${name} is not an allowed key`);
                continue;
            }
            const declared = own(properties, name);
            if (declared) {
                errors.push(...validateValue(declared, child, `${path}.${name}`, depth + 1));
                continue;
            }
            if (schema.additionalProperties === false) {
                errors.push(`${path}.${name} is not a declared property`);
            } else if (isRecord(schema.additionalProperties) || (schema.additionalProperties && typeof schema.additionalProperties === 'object')) {
                errors.push(...validateValue(schema.additionalProperties as ValueType, child, `${path}.${name}`, depth + 1));
            }
        }
    }

    if (schema.kind === 'array' && Array.isArray(value) && schema.items) {
        value.forEach((entry, index) => {
            errors.push(...validateValue(schema.items as ValueType, entry, `${path}[${index}]`, depth + 1));
        });
    }

    return errors;
}

function enumsFit(source: Primitive[] | undefined, target: Primitive[] | undefined): boolean {
    if (!target) return true;
    if (!source) return false;
    return source.every(entry => target.some(allowed => Object.is(allowed, entry)));
}

/**
 * True when every value accepted by `source` is accepted by `target`.
 * `any` as a target accepts everything. `any` as a source does not.
 */
export function isAssignable(source: ValueType, target: ValueType): boolean {
    if (target.kind === 'any') return true;
    if (source.kind === 'any') return false;
    if (source.nullable && !target.nullable && target.kind !== 'null') return false;
    if (!enumsFit(source.enum, target.enum)) return false;

    if (source.kind === 'integer' && target.kind === 'number') {
        return true;
    }
    if (source.kind !== target.kind) return false;

    if (source.kind === 'array') {
        if (!target.items) return true;
        if (!source.items) return false;
        return isAssignable(source.items, target.items);
    }

    if (source.kind === 'object') {
        const sourceProps = source.properties ?? {};
        const targetProps = target.properties ?? {};
        for (const name of target.required ?? []) {
            const from = own(sourceProps, name);
            const to = own(targetProps, name);
            if (!from || !to || !isAssignable(from, to)) return false;
            if (!(source.required ?? []).includes(name)) return false;
        }
        for (const [name, from] of Object.entries(sourceProps)) {
            const to = own(targetProps, name);
            if (to) {
                if (!isAssignable(from, to)) return false;
                continue;
            }
            if (target.additionalProperties === false) return false;
            if (target.additionalProperties && typeof target.additionalProperties === 'object') {
                if (!isAssignable(from, target.additionalProperties)) return false;
            }
        }
    }

    return true;
}
