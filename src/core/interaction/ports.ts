// ============================================
// WP-OMNI-01 — typed graph admission.
// Declared ports are a runtime contract. A wire is an admitted edge,
// not a line the canvas draws first.
// ============================================

import type { BlockInstance, PortDataType, PortSchema } from '@/core/schemas/block.schema';

export type Admission =
    | {
          ok: true;
          sourcePortId: string;
          targetPortId: string;
          sourceType: PortDataType;
          targetType: PortDataType;
      }
    | { ok: false; reason: AdmissionReason };

export type AdmissionReason =
    | 'missing-block'
    | 'cross-shell'
    | 'self-wire'
    | 'no-output'
    | 'no-input'
    | 'incompatible-type'
    | 'kept-separate';

const UNTYPED_OUT: PortSchema = {
    id: 'out',
    direction: 'output',
    dataType: 'any',
    label: 'Untyped output'
};

const UNTYPED_IN: PortSchema = {
    id: 'in',
    direction: 'input',
    dataType: 'any',
    label: 'Untyped input'
};

/** `any` on an input accepts every output. An untyped output only feeds `any`. */
export function portsCompatible(output: PortDataType, input: PortDataType): boolean {
    if (input === 'any') return true;
    if (output === 'any') return false;
    return output === input;
}

function portById(ports: PortSchema[], id: string | undefined, direction: PortSchema['direction']): PortSchema | undefined {
    const same = ports.filter(port => port.direction === direction);
    if (id) return same.find(port => port.id === id);
    return same[0];
}

export function evaluateWireAdmission(
    source: BlockInstance | undefined,
    target: BlockInstance | undefined,
    options: {
        sourcePortId?: string;
        targetPortId?: string;
        separated?: boolean;
    } = {}
): Admission {
    if (!source || !target) return { ok: false, reason: 'missing-block' };
    if (source.instance_id === target.instance_id) return { ok: false, reason: 'self-wire' };
    if (source.shellId !== target.shellId) return { ok: false, reason: 'cross-shell' };
    if (options.separated) return { ok: false, reason: 'kept-separate' };

    const sourcePorts = source.schema.ports?.length ? source.schema.ports : [UNTYPED_OUT];
    const targetPorts = target.schema.ports?.length ? target.schema.ports : [UNTYPED_IN];
    const output = portById(sourcePorts, options.sourcePortId, 'output');
    const input = portById(targetPorts, options.targetPortId, 'input');
    if (!output) return { ok: false, reason: 'no-output' };
    if (!input) return { ok: false, reason: 'no-input' };
    if (!portsCompatible(output.dataType, input.dataType)) {
        return { ok: false, reason: 'incompatible-type' };
    }
    return {
        ok: true,
        sourcePortId: output.id,
        targetPortId: input.id,
        sourceType: output.dataType,
        targetType: input.dataType
    };
}
