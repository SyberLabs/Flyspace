import { describe, expect, it } from 'vitest';
import { admitProposal } from './admission';
import { openapiProvider } from './providers/openapiProvider';
import { isAssignable } from './valueType';
import { fromJsonSchema } from './jsonSchema';
import { compileOpenApi } from './openapi';

/** Google Calendar's shape: one nested response field declares no type. */
function spec(response: Record<string, unknown>, parameter?: Record<string, unknown>) {
    return {
        openapi: '3.0.3',
        info: { title: 'Events', version: '1' },
        servers: [{ url: 'https://events.example.test' }],
        paths: {
            '/events': {
                get: {
                    operationId: 'events.list',
                    ...(parameter ? { parameters: [parameter] } : {}),
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: response } } } }
                }
            }
        }
    };
}

const EVENTS = {
    type: 'object',
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    summary: { type: 'string' },
                    workingLocation: { type: 'object', properties: { homeOffice: { description: 'If present, the user is working at home.' } } }
                }
            }
        }
    }
};

describe('untyped fields in a response', () => {
    it('types a nested field the spec leaves untyped as any, and keeps the operation', () => {
        const { manifests, errors } = compileOpenApi(spec(EVENTS));
        expect(errors).toEqual([]);
        const event = manifests[0].output.schema.properties!.items.items!;
        expect(event.properties!.summary.kind).toBe('string');
        expect(event.properties!.workingLocation.properties!.homeOffice).toEqual({ kind: 'any', description: 'If present, the user is working at home.' });
    });

    it('still refuses a response that is untyped as a whole, or a list of untyped items', () => {
        expect(compileOpenApi(spec({ description: 'anything' })).errors[0].message).toBe('schema does not declare a type');
        expect(compileOpenApi(spec({ type: 'array', items: { description: 'anything' } })).errors[0].message).toBe('schema does not declare a type');
    });

    it('still refuses an untyped input', () => {
        const { errors } = compileOpenApi(spec(EVENTS, { name: 'filter', in: 'query', schema: { description: 'anything' } }));
        expect(errors[0].message).toBe('filter: schema does not declare a type');
    });

    it('is refused by default outside a response', () => {
        expect(fromJsonSchema({ type: 'object', properties: { a: {} } })).toEqual({ ok: false, error: 'schema does not declare a type' });
    });

    it('cannot feed a typed input: an any source is not assignable to a string', () => {
        expect(isAssignable({ kind: 'any' }, { kind: 'string' })).toBe(false);
    });
});

describe('admitting a provider proposal with an untyped field', () => {
    it('admits a typed result with a nested any field, through the same rule as the install dialog', async () => {
        const request = { document: spec(EVENTS), sourceLocator: 'fixture://events', discoveredAtMs: 1 };
        const { candidates } = await openapiProvider.discover(request);
        const proposal = await openapiProvider.materialize(candidates[0], { request });
        const admitted = admitProposal(proposal, { nowMs: 1 });
        expect(admitted.errors).toEqual([]);
        expect(admitted.ok).toBe(true);
    });
});
