// The one way a manifest's path template and an input become a URL path.
// A path argument fills one segment of the template and nothing else: the
// resolved pathname must be exactly the expanded template.

import type { ValueType } from './valueType';

export function joinUrl(baseUrl: string, path: string): URL {
    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const relative = path.startsWith('/') ? path.slice(1) : path;
    return new URL(relative, base);
}

/** An array of strings, numbers, or booleans: a query list Flyspace can send. */
export function isPlainList(schema: ValueType): boolean {
    return schema.kind === 'array' && !!schema.items
        && (schema.items.kind === 'string' || schema.items.kind === 'number' || schema.items.kind === 'integer' || schema.items.kind === 'boolean');
}

/**
 * Put one query argument on a URL. A list is sent the OpenAPI default way for
 * a query (form, exploded): one `name=value` per element, in order.
 */
export function setQueryParam(params: URLSearchParams, name: string, value: unknown): void {
    if (Array.isArray(value)) {
        params.delete(name);
        for (const element of value) params.append(name, stringifyParam(element));
        return;
    }
    params.set(name, stringifyParam(value));
}

export function stringifyParam(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

/**
 * Fill `{name}` placeholders, then join onto the base URL. Refuses a value
 * that is a dot segment, and refuses any result whose pathname differs from
 * the literal expansion (which is what URL normalization would change).
 */
export function resolveHttpPath(
    baseUrl: string,
    template: string,
    input: Record<string, unknown>
): { url: URL } | { error: string } {
    const refused: string[] = [];
    const filled = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
        const supplied = Object.hasOwn(input, name) ? input[name] : undefined;
        const value = supplied === undefined ? '' : stringifyParam(supplied);
        if (value === '.' || value === '..') refused.push(name);
        return encodeURIComponent(value);
    });
    if (refused.length > 0) return { error: `path input ${refused.join(', ')} cannot be a dot segment` };
    let url: URL;
    try {
        url = joinUrl(baseUrl, filled);
    } catch {
        return { error: 'the request URL could not be built' };
    }
    const base = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const expected = `${base.pathname}${filled.startsWith('/') ? filled.slice(1) : filled}`;
    if (url.pathname !== expected) return { error: 'path inputs changed the request path' };
    return { url };
}
