// Project a native typed value into the lossy OmniData envelope the
// existing gateway, feed view, and wire extractor already understand.
// The typed value itself is not placed on that envelope.

import { createOmniData, createOmniError, type OmniData, type OmniItem } from '../gateway/omnidata.schema';
import type { CapabilityManifest } from './manifest';
import { isRecord, type ValueType } from './valueType';

export interface TypedValue {
    schema: ValueType;
    value: unknown;
}

export interface CapabilityError {
    code: string;
    message: string;
    retryable: boolean;
}

export interface CapabilityResult {
    ok: boolean;
    capabilityId: string;
    typed: TypedValue | null;
    presentation: OmniData;
    error?: CapabilityError;
}

const CAPABILITY_RESULT = Symbol.for('omni.capabilityResult');

export function brandResult<T extends object>(result: T): T {
    Object.defineProperty(result, CAPABILITY_RESULT, { value: true });
    return result;
}

export function isCapabilityResult(value: unknown): value is CapabilityResult {
    return typeof value === 'object'
        && value !== null
        && (value as Record<symbol, unknown>)[CAPABILITY_RESULT] === true;
}

export function projectSuccess(manifest: CapabilityManifest, typed: TypedValue): OmniData {
    const ttl = manifest.effect === 'read' ? 60_000 : 0;
    const items = projectItems(typed.value, manifest);
    if (items) {
        return createOmniData(manifest.id, 'custom', { items }, ttl);
    }
    if (typeof typed.value === 'string') {
        return createOmniData(manifest.id, 'custom', {
            content: { text: typed.value, type: 'text' }
        }, ttl);
    }
    return createOmniData(manifest.id, 'custom', {
        items: [toItem(typed.value, manifest.id, 0, manifest.output.titlePath)]
    }, ttl);
}

export function projectError(manifestId: string, error: CapabilityError): OmniData {
    return createOmniError(manifestId, 'custom', error);
}

function projectItems(value: unknown, manifest: CapabilityManifest): OmniItem[] | null {
    const list = manifest.output.itemsPath
        ? readPath(value, manifest.output.itemsPath)
        : manifest.output.schema.kind === 'array'
            ? value
            : undefined;
    if (!Array.isArray(list)) return null;
    return list.map((entry, index) => toItem(entry, manifest.id, index, manifest.output.titlePath));
}

function toItem(entry: unknown, capabilityId: string, index: number, titlePath?: string): OmniItem {
    if (!isRecord(entry)) {
        return {
            id: `${capabilityId}-${index}`,
            title: entry == null ? 'Empty' : String(entry).slice(0, 180)
        };
    }
    const titled = titlePath ? readPath(entry, titlePath) : undefined;
    const spoken = typeof entry.spoken === 'string' ? entry.spoken
        : typeof entry.transcript === 'string' ? entry.transcript
            : undefined;
    const title = typeof titled === 'string'
        ? titled
        : typeof entry.title === 'string'
            ? entry.title
            : typeof entry.name === 'string'
                ? entry.name
                : spoken
                    ? spoken.slice(0, 180)
                    : typeof entry.id === 'string' || typeof entry.id === 'number'
                        ? String(entry.id)
                        : 'Result';
    const id = typeof entry.id === 'string' || typeof entry.id === 'number'
        ? String(entry.id)
        : `${capabilityId}-${index}`;
    const description = typeof entry.body === 'string'
        ? entry.body
        : typeof entry.description === 'string'
            ? entry.description
            : undefined;
    const metadata: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(entry)) {
        if (key === 'id' || key === 'title' || key === 'name' || key === 'body' || key === 'description') continue;
        if (child === null || ['string', 'number', 'boolean'].includes(typeof child)) metadata[key] = child;
    }
    return {
        id,
        title,
        ...(description ? { description: description.slice(0, 500) } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadata } : {})
    };
}

function readPath(value: unknown, path: string): unknown {
    let current = value;
    for (const segment of path.split('.')) {
        if (!isRecord(current) || !(segment in current)) return undefined;
        current = current[segment];
    }
    return current;
}
