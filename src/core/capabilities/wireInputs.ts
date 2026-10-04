// Pull callable arguments out of inbound wires.
// Explicit block params and run() arguments win over this. A wire that
// does not match an input is ignored rather than failing the whole call.

import { useBlockStore } from '../stores/blockStore';
import { useWireStore } from '../stores/wireStore';
import type { WireProjection } from './compatibility';
import type { CapabilityManifest } from './manifest';
import { readCapability } from './state';
import { isRecord, validateValue } from './valueType';

export function resolveWiredInputs(instanceId: string): Record<string, unknown> {
    const block = useBlockStore.getState().getBlock(instanceId);
    const capabilityId = block?.schema.capabilityId;
    if (!capabilityId) return {};
    const manifest = readCapability(capabilityId);
    if (!manifest) return {};

    const merged: Record<string, unknown> = {};
    const wires = useWireStore.getState().getWiresToBlock(instanceId)
        .filter(wire => wire.status === 'active');
    for (const wire of wires) {
        const source = useBlockStore.getState().getBlock(wire.sourceBlockId);
        if (!source?.data) continue;
        Object.assign(merged, contributionFrom(source.data, manifest, wire.projection));
    }
    return merged;
}

function contributionFrom(
    data: unknown,
    manifest: CapabilityManifest,
    projection?: WireProjection
): Record<string, unknown> {
    if (!isRecord(data)) return {};
    const kind = projection?.kind;

    if (kind === 'join_titles') {
        const textInput = stringSink(manifest);
        const text = joinedTitles(data);
        return textInput && text ? { [textInput]: text } : {};
    }

    const typed = isRecord(data.typed) ? data.typed.value : undefined;
    if (typed !== undefined) {
        const fromTyped = matchValue(typed, manifest);
        if (Object.keys(fromTyped).length > 0) return fromTyped;
    }
    if (kind === 'identity') return {};

    const textInput = stringSink(manifest);
    if (!textInput) return {};

    const answer = lastAssistantText(data);
    if (answer) return { [textInput]: answer };

    if (typeof data.content === 'string' && data.content.trim()) {
        return { [textInput]: data.content };
    }

    const titles = joinedTitles(data);
    if (titles) return { [textInput]: titles };

    return {};
}

function joinedTitles(data: Record<string, unknown>): string | null {
    if (!Array.isArray(data.items)) return null;
    const lines = data.items
        .map(item => isRecord(item) && typeof item.title === 'string' ? item.title : '')
        .filter(Boolean);
    return lines.length > 0 ? lines.join('\n') : null;
}

function matchValue(value: unknown, manifest: CapabilityManifest): Record<string, unknown> {
    if (isRecord(value)) {
        const picked: Record<string, unknown> = {};
        for (const input of manifest.inputs) {
            if (!Object.hasOwn(value, input.name)) continue;
            if (validateValue(input.schema, value[input.name]).length === 0) {
                picked[input.name] = value[input.name];
            }
        }
        if (Object.keys(picked).length > 0) return picked;
    }

    if (manifest.inputs.length === 1) {
        const only = manifest.inputs[0];
        if (validateValue(only.schema, value).length === 0) return { [only.name]: value };
    }
    return {};
}

/** The only required string argument, so prose from a wire has one place to land. */
function stringSink(manifest: CapabilityManifest): string | null {
    const required = manifest.inputs.filter(input => input.required);
    if (required.length !== 1 || required[0].schema.kind !== 'string') return null;
    return required[0].name;
}

function lastAssistantText(data: Record<string, unknown>): string | null {
    if (!Array.isArray(data.messages)) return null;
    for (let i = data.messages.length - 1; i >= 0; i--) {
        const message = data.messages[i];
        if (!isRecord(message) || message.role !== 'assistant' || typeof message.content !== 'string') continue;
        if (message.content.startsWith('⚠️')) continue;
        const text = message.content.trim();
        if (text) return text;
    }
    return null;
}
