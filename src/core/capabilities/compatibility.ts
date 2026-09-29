// Every product path that creates a wire asks admitConnection first.
// A typed mismatch is refused. A string sink may admit an explicit projection
// instead of pretending the source type was already text.

import type { PortSchema } from '../schemas/block.schema';
import { useBlockStore } from '../stores/blockStore';
import { getInputPorts, getOutputPorts } from '../services/port.service';
import { isAssignable, type ValueType } from './valueType';

function isStringSink(schema: ValueType | undefined): boolean {
    if (!schema) return false;
    if (schema.kind === 'string') return true;
    if (schema.kind !== 'object') return false;
    const required = schema.required ?? [];
    if (required.length !== 1) return false;
    return schema.properties?.[required[0]]?.kind === 'string';
}

export type WireProjectionKind = 'identity' | 'text' | 'join_titles';

export interface WireProjection {
    kind: WireProjectionKind;
}

export type ConnectionAdmission =
    | { ok: true; sourcePortId?: string; targetPortId?: string; projection: WireProjection }
    | { ok: false; reason: string };

export function admitConnection(sourceBlockId: string, targetBlockId: string): ConnectionAdmission {
    if (sourceBlockId === targetBlockId) {
        return { ok: false, reason: 'a block cannot wire to itself' };
    }
    const source = useBlockStore.getState().getBlock(sourceBlockId);
    const target = useBlockStore.getState().getBlock(targetBlockId);
    if (!source || !target) return { ok: false, reason: 'both ends of a wire must be blocks' };
    if (source.shellId !== target.shellId) return { ok: false, reason: 'wires stay inside one shell' };

    const sourcePort = getOutputPorts(source.schema)[0];
    const targetPort = getInputPorts(target.schema)[0];
    const ports = { sourcePortId: sourcePort?.id, targetPortId: targetPort?.id };

    const stringSink = isStringSink(targetPort?.schema);
    if (sourcePort?.schema && targetPort?.schema && targetPort.schema.kind !== 'any' && targetPort.dataType !== 'any') {
        if (isAssignable(sourcePort.schema, targetPort.schema)) {
            return { ok: true, ...ports, projection: { kind: 'identity' } };
        }
        if (stringSink && sourcePort.schema.kind === 'array') {
            return { ok: true, ...ports, projection: { kind: 'join_titles' } };
        }
        const sourceLabel = sourcePort.label ?? sourcePort.id;
        const targetLabel = targetPort.label ?? targetPort.id;
        return {
            ok: false,
            reason: `${source.schema.display_name}.${sourceLabel} (${sourcePort.schema.kind}) is not assignable to ${target.schema.display_name}.${targetLabel} (${targetPort.schema.kind})`
        };
    }

    if (stringSink) {
        const kind: WireProjectionKind = sourcePort?.schema?.kind === 'array' ? 'join_titles' : 'text';
        return { ok: true, ...ports, projection: { kind } };
    }

    return { ok: true, ...ports, projection: { kind: 'identity' } };
}

export function explainPortWire(sourceBlockId: string, targetBlockId: string): string | null {
    const admission = admitConnection(sourceBlockId, targetBlockId);
    return admission.ok ? null : admission.reason;
}

export function portDataTypeFor(kind: string): PortSchema['dataType'] {
    if (kind === 'string') return 'text';
    if (kind === 'any') return 'any';
    return 'json';
}
