// JSON Schema (the subset OpenAPI uses) → ValueType.
// Schemas we cannot represent honestly come back as an error so callers
// can fail the operation instead of pretending the contract is `any`.

import { isRecord, type ValueType } from './valueType';

const MAX_DEPTH = 24;

export type SchemaConversion =
    | { ok: true; schema: ValueType }
    | { ok: false; error: string };

export function fromJsonSchema(
    schema: unknown,
    root: unknown = schema,
    seen: string[] = [],
    depth = 0
): SchemaConversion {
    if (depth > MAX_DEPTH) return { ok: false, error: 'schema exceeds max depth' };
    if (!isRecord(schema)) return { ok: false, error: 'schema must be an object' };

    if (typeof schema.$ref === 'string') {
        if (seen.includes(schema.$ref)) {
            return { ok: false, error: `cyclic $ref ${schema.$ref} is not a typed contract` };
        }
        const resolved = resolveRef(root, schema.$ref);
        if (!resolved) return { ok: false, error: `unresolved $ref ${schema.$ref}` };
        return fromJsonSchema(resolved, root, [...seen, schema.$ref], depth + 1);
    }

    if (Array.isArray(schema.allOf)) {
        return mergeAllOf(schema.allOf, root, seen, depth);
    }
    if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
        const branches = (schema.oneOf ?? schema.anyOf) as unknown[];
        if (branches.length === 1) return fromJsonSchema(branches[0], root, seen, depth + 1);
        return { ok: false, error: 'oneOf/anyOf with several branches is not a single ValueType' };
    }
    if (schema.not !== undefined) return { ok: false, error: 'not is unsupported' };

    const nullable = schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'));
    const rawType = Array.isArray(schema.type)
        ? schema.type.find(entry => entry !== 'null')
        : schema.type;

    if (schema.properties && rawType === undefined) {
        return objectSchema(schema, nullable, root, seen, depth);
    }
    if (schema.items && rawType === undefined) {
        return arraySchema(schema, nullable, root, seen, depth);
    }
    if (rawType === undefined && schema.enum) {
        const sample = (schema.enum as unknown[])[0];
        const kind = sample === null ? 'null'
            : typeof sample === 'string' ? 'string'
                : typeof sample === 'boolean' ? 'boolean'
                    : typeof sample === 'number' ? (Number.isInteger(sample) ? 'integer' : 'number')
                        : undefined;
        if (!kind) return { ok: false, error: 'enum values must be primitive' };
        return finish({ kind, nullable: nullable || (schema.enum as unknown[]).includes(null) }, schema);
    }
    if (rawType === undefined) {
        return { ok: false, error: 'schema does not declare a type' };
    }
    if (typeof rawType !== 'string') return { ok: false, error: 'schema type is invalid' };

    switch (rawType) {
        case 'string':
        case 'boolean':
        case 'number':
        case 'integer':
        case 'null':
            return finish({ kind: rawType, nullable: nullable && rawType !== 'null' }, schema);
        case 'object':
            return objectSchema(schema, nullable, root, seen, depth);
        case 'array':
            return arraySchema(schema, nullable, root, seen, depth);
        default:
            return { ok: false, error: `unsupported schema type ${rawType}` };
    }
}

function finish(base: ValueType, schema: Record<string, unknown>): SchemaConversion {
    const next: ValueType = { ...base };
    if (typeof schema.description === 'string') next.description = schema.description.slice(0, 500);
    if (typeof schema.format === 'string') next.format = schema.format.slice(0, 64);
    if (Array.isArray(schema.enum)) {
        const values = schema.enum.filter(entry =>
            entry === null || ['string', 'number', 'boolean'].includes(typeof entry)
        );
        if (values.length !== schema.enum.length) return { ok: false, error: 'enum values must be primitive' };
        next.enum = values as ValueType['enum'];
    }
    if (next.nullable === false) delete next.nullable;
    return { ok: true, schema: next };
}

function objectSchema(
    schema: Record<string, unknown>,
    nullable: boolean,
    root: unknown,
    seen: string[],
    depth: number
): SchemaConversion {
    const properties: Record<string, ValueType> = {};
    if (schema.properties !== undefined) {
        if (!isRecord(schema.properties)) return { ok: false, error: 'properties must be an object' };
        for (const [name, child] of Object.entries(schema.properties)) {
            const converted = fromJsonSchema(child, root, seen, depth + 1);
            if (!converted.ok) return converted;
            properties[name] = converted.schema;
        }
    }
    const required = Array.isArray(schema.required)
        ? schema.required.filter((name): name is string => typeof name === 'string')
        : undefined;
    let additional: ValueType['additionalProperties'];
    if (schema.additionalProperties === false) additional = false;
    else if (isRecord(schema.additionalProperties)) {
        const converted = fromJsonSchema(schema.additionalProperties, root, seen, depth + 1);
        if (!converted.ok) return converted;
        additional = converted.schema;
    }
    return finish({
        kind: 'object',
        nullable,
        properties,
        ...(required && required.length > 0 ? { required } : {}),
        ...(additional !== undefined ? { additionalProperties: additional } : {})
    }, schema);
}

function arraySchema(
    schema: Record<string, unknown>,
    nullable: boolean,
    root: unknown,
    seen: string[],
    depth: number
): SchemaConversion {
    if (schema.items === undefined) {
        return finish({ kind: 'array', nullable }, schema);
    }
    const converted = fromJsonSchema(schema.items, root, seen, depth + 1);
    if (!converted.ok) return converted;
    return finish({ kind: 'array', nullable, items: converted.schema }, schema);
}

function mergeAllOf(branches: unknown[], root: unknown, seen: string[], depth: number): SchemaConversion {
    const converted = branches.map(branch => fromJsonSchema(branch, root, seen, depth + 1));
    const failed = converted.find(entry => !entry.ok);
    if (failed && !failed.ok) return failed;
    const schemas = converted.map(entry => (entry as { ok: true; schema: ValueType }).schema);
    if (schemas.some(schema => schema.kind !== 'object')) {
        return { ok: false, error: 'allOf is only merged for object schemas' };
    }
    const properties: Record<string, ValueType> = {};
    const required = new Set<string>();
    let additional: ValueType['additionalProperties'];
    let nullable = false;
    for (const schema of schemas) {
        Object.assign(properties, schema.properties);
        schema.required?.forEach(name => required.add(name));
        if (schema.nullable) nullable = true;
        if (schema.additionalProperties === false) additional = false;
    }
    return {
        ok: true,
        schema: {
            kind: 'object',
            properties,
            ...(required.size > 0 ? { required: [...required] } : {}),
            ...(additional !== undefined ? { additionalProperties: additional } : {}),
            ...(nullable ? { nullable } : {})
        }
    };
}

function resolveRef(root: unknown, ref: string): unknown {
    if (!ref.startsWith('#/')) return undefined;
    const parts = ref.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    let current: unknown = root;
    for (const part of parts) {
        if (!isRecord(current) || !(part in current)) return undefined;
        current = current[part];
    }
    return current;
}
