import { describe, expect, it } from 'vitest';
import { compileOpenApi } from './openapi';

function spec(parameter: Record<string, unknown>) {
    return {
        openapi: '3.0.3',
        info: { title: 'Events', version: '1' },
        servers: [{ url: 'https://events.example.test' }],
        paths: {
            '/events': {
                get: {
                    operationId: 'events.list',
                    parameters: [
                        { name: 'q', in: 'query', schema: { type: 'string' } },
                        parameter
                    ],
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } }
                }
            }
        }
    };
}

describe('compound query and header parameters', () => {
    it('leaves an optional array parameter out, and keeps the operation', () => {
        const { manifests, errors } = compileOpenApi(spec({ name: 'eventTypes', in: 'query', style: 'form', explode: true, schema: { type: 'array', items: { type: 'string' } } }));
        expect(errors).toEqual([]);
        expect(manifests[0].inputs.map(input => input.name)).toEqual(['q']);
    });

    it('leaves an optional object header out', () => {
        const { manifests } = compileOpenApi(spec({ name: 'X-Filter', in: 'header', schema: { type: 'object', properties: { a: { type: 'string' } } } }));
        expect(manifests[0].inputs.map(input => input.name)).toEqual(['q']);
    });

    it('still refuses an operation whose required parameter is compound', () => {
        const { manifests, errors } = compileOpenApi(spec({ name: 'ids', in: 'query', required: true, schema: { type: 'array', items: { type: 'string' } } }));
        expect(manifests).toEqual([]);
        expect(errors[0].message).toBe('ids: compound query parameters are outside the supported subset');
    });
});
