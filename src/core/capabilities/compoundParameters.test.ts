import { describe, expect, it } from 'vitest';
import { compileOpenApi } from './openapi';

function spec(parameter: Record<string, unknown>, method = 'get') {
    return {
        openapi: '3.0.3',
        info: { title: 'Events', version: '1' },
        servers: [{ url: 'https://events.example.test' }],
        paths: {
            '/events': {
                [method]: {
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
    it('leaves an optional list it cannot send out, and keeps the operation', () => {
        // Comma-joined (explode: false) is not sent; a plain exploded list is (listQueryParameters.test.ts).
        const { manifests, errors } = compileOpenApi(spec({ name: 'eventTypes', in: 'query', style: 'form', explode: false, schema: { type: 'array', items: { type: 'string' } } }));
        expect(errors).toEqual([]);
        expect(manifests[0].inputs.map(input => input.name)).toEqual(['q']);
    });

    it('leaves an optional object header out', () => {
        const { manifests } = compileOpenApi(spec({ name: 'X-Filter', in: 'header', schema: { type: 'object', properties: { a: { type: 'string' } } } }));
        expect(manifests[0].inputs.map(input => input.name)).toEqual(['q']);
    });

    it('still refuses a write with an optional compound parameter', () => {
        const { manifests, errors } = compileOpenApi(spec({ name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } }, 'post'));
        expect(manifests).toEqual([]);
        expect(errors[0].message).toBe('tags: compound query parameters are outside the supported subset');
    });

    it('still refuses an operation whose required parameter is compound', () => {
        const { manifests, errors } = compileOpenApi(spec({ name: 'ids', in: 'query', required: true, schema: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } } }));
        expect(manifests).toEqual([]);
        expect(errors[0].message).toBe('ids: compound query parameters are outside the supported subset');
    });
});

describe('optional parameters whose name cannot be an input', () => {
    const xgafv = { name: '$.xgafv', in: 'query', schema: { type: 'string', enum: ['1', '2'] } };

    it('leaves the Google $.xgafv parameter out of a read', () => {
        const { manifests, errors } = compileOpenApi(spec(xgafv));
        expect(errors).toEqual([]);
        expect(manifests[0].inputs.map(input => input.name)).toEqual(['q']);
    });

    it('still refuses it on a write, and when it is required', () => {
        expect(compileOpenApi(spec(xgafv, 'post')).manifests).toEqual([]);
        expect(compileOpenApi(spec({ ...xgafv, required: true })).manifests).toEqual([]);
    });
});
