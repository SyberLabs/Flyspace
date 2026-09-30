import type { PortSchema, OmniBlockSchema } from '@/core/schemas/block.schema';

/** Get the declared input ports for rendering block handles. */
export function getInputPorts(schema: OmniBlockSchema): PortSchema[] {
    return schema.ports?.filter(port => port.direction === 'input') || [];
}

/** Get the declared output ports for rendering block handles. */
export function getOutputPorts(schema: OmniBlockSchema): PortSchema[] {
    return schema.ports?.filter(port => port.direction === 'output') || [];
}

export function createJsonOutputPort(id: string = 'out', label?: string): PortSchema {
    return {
        id,
        direction: 'output',
        dataType: 'json',
        label: label || 'JSON Data',
        description: 'Structured data output'
    };
}

export function createTextOutputPort(id: string = 'out', label?: string): PortSchema {
    return {
        id,
        direction: 'output',
        dataType: 'text',
        label: label || 'Text',
        description: 'Plain text or markdown output'
    };
}

export function createAnyInputPort(id: string = 'in', label?: string): PortSchema {
    return {
        id,
        direction: 'input',
        dataType: 'any',
        label: label || 'Input',
        description: 'Accepts any admitted output type'
    };
}
