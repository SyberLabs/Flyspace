import { describe, expect, it } from 'vitest';
import { compileOpenApi } from './openapi';
import { validateManifest } from './manifest';

// Interzoid's shape: every parameter is described on the parameter object,
// not in its schema. That is how most specs in the directory write it.
function spec(parameters: unknown[]) {
    return {
        openapi: '3.0.0',
        info: { title: 'Weather', version: '1' },
        servers: [{ url: 'https://api.weather.example.test' }],
        paths: {
            '/getweather': {
                get: {
                    summary: 'Current weather',
                    parameters,
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
                }
            }
        }
    };
}

function inputs(parameters: unknown[]) {
    const compiled = compileOpenApi(spec(parameters));
    expect(compiled.errors).toEqual([]);
    return Object.fromEntries(compiled.manifests[0].inputs.map(input => [input.name, input]));
}

describe('what a compiled input keeps from the spec', () => {
    it('keeps the description written on the parameter, not only the schema', () => {
        const byName = inputs([
            { name: 'city', in: 'query', required: true, description: 'City for weather information', schema: { type: 'string' } },
            { name: 'state', in: 'query', description: 'ignored when the schema says it', schema: { type: 'string', description: 'Two-letter state' } }
        ]);
        expect(byName.city.schema.description).toBe('City for weather information');
        expect(byName.state.schema.description).toBe('Two-letter state');
    });

    it('keeps a primitive example and default, from wherever the spec puts them', () => {
        const byName = inputs([
            { name: 'city', in: 'query', example: 'Seattle', schema: { type: 'string' } },
            { name: 'units', in: 'query', schema: { type: 'string', enum: ['metric', 'us'], default: 'us' } },
            { name: 'days', in: 'query', examples: { week: { value: 7 } }, schema: { type: 'integer', example: 3 } }
        ]);
        expect(byName.city.example).toBe('Seattle');
        expect(byName.units.default).toBe('us');
        expect(byName.days.example).toBe(3); // the parameter's own example would win; the schema's comes before `examples`
    });

    it('drops examples that are not short primitives, rather than cutting them', () => {
        const byName = inputs([
            { name: 'filter', in: 'query', example: { a: 1 }, schema: { type: 'string' } },
            { name: 'note', in: 'query', example: 'x'.repeat(201), schema: { type: 'string' } }
        ]);
        expect(byName.filter.example).toBeUndefined();
        expect(byName.note.example).toBeUndefined();
    });

    it('keeps no sample value for an input that looks like a key', () => {
        const byName = inputs([
            { name: 'webhook_secret', in: 'query', example: 'whsec_123', description: 'Shared secret the webhook signs with', schema: { type: 'string' } },
            { name: 'page_token', in: 'query', example: 'abc123', description: 'Token for the next page of results', schema: { type: 'string' } }
        ]);
        expect(byName.webhook_secret.example).toBeUndefined();
        expect(byName.webhook_secret.schema.description).toBe('Shared secret the webhook signs with');
        expect(byName.page_token.example).toBe('abc123'); // a cursor, not a key
    });

    it('seals the hints into the manifest, and rejects a hint that is not a primitive', () => {
        const manifest = compileOpenApi(spec([{ name: 'city', in: 'query', example: 'Seattle', schema: { type: 'string' } }])).manifests[0];
        expect(validateManifest(manifest).ok).toBe(true);

        const tampered = { ...manifest, inputs: [{ ...manifest.inputs[0], example: { nested: true } }] };
        expect(validateManifest(tampered).errors).toContain('input city example must be a short primitive');
    });
});
