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

export function createMediaOutputPort(id: string = 'out', label?: string): PortSchema {
    return {
        id,
        direction: 'output',
        dataType: 'media',
        label: label || 'Media',
        description: 'Image, PDF, or other media output'
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

export function createJsonInputPort(id: string = 'in', label?: string): PortSchema {
    return {
        id,
        direction: 'input',
        dataType: 'json',
        label: label || 'JSON Data',
        description: 'Structured data input'
    };
}

export function createTextInputPort(id: string = 'in', label?: string): PortSchema {
    return {
        id,
        direction: 'input',
        dataType: 'text',
        label: label || 'Text',
        description: 'Plain text or markdown input'
    };
}
