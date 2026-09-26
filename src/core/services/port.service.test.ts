import { describe, it, expect } from 'vitest';
import {
    getInputPorts,
    getOutputPorts,
    createAnyInputPort,
    createJsonOutputPort,
    createTextOutputPort
} from './port.service';
import type { OmniBlockSchema, PortSchema } from '@/core/schemas/block.schema';

function schema(ports: PortSchema[]): OmniBlockSchema {
    return { ports } as unknown as OmniBlockSchema;
}

describe('port display metadata', () => {
    it('filters ports by direction for block handles', () => {
        const block = schema([
            createAnyInputPort('in'),
            createJsonOutputPort('out'),
            createTextOutputPort('summary')
        ]);

        expect(getInputPorts(block).map(port => port.id)).toEqual(['in']);
        expect(getOutputPorts(block).map(port => port.id)).toEqual(['out', 'summary']);
    });

    it('keeps the declared type and label for the visual hint', () => {
        expect(createJsonOutputPort('out', 'Market Data')).toMatchObject({
            id: 'out',
            direction: 'output',
            dataType: 'json',
            label: 'Market Data'
        });
    });
});
