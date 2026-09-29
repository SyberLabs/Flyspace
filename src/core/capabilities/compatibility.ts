// Port compatibility for wires whose endpoints both carry a ValueType.
// Ports without a schema stay unconstrained, which is the existing canvas.

import type { PortSchema } from '../schemas/block.schema';
import { useBlockStore } from '../stores/blockStore';
import { getInputPorts, getOutputPorts } from '../services/port.service';
import { isAssignable } from './valueType';

export function explainPortWire(sourceBlockId: string, targetBlockId: string): string | null {
    const source = useBlockStore.getState().getBlock(sourceBlockId);
    const target = useBlockStore.getState().getBlock(targetBlockId);
    if (!source || !target) return null;

    const sourcePort = getOutputPorts(source.schema)[0];
    const targetPort = getInputPorts(target.schema)[0];
    if (!sourcePort || !targetPort) return null;
    if (!sourcePort.schema || !targetPort.schema) return null;
    if (targetPort.dataType === 'any') return null;
    if (isAssignable(sourcePort.schema, targetPort.schema)) return null;

    const sourceLabel = sourcePort.label ?? sourcePort.id;
    const targetLabel = targetPort.label ?? targetPort.id;
    return `${source.schema.display_name}.${sourceLabel} (${sourcePort.schema.kind}) is not assignable to ${target.schema.display_name}.${targetLabel} (${targetPort.schema.kind})`;
}

export function portDataTypeFor(kind: string): PortSchema['dataType'] {
    if (kind === 'string') return 'text';
    if (kind === 'any') return 'any';
    return 'json';
}
