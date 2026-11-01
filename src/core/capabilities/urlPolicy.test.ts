import { describe, it, expect, beforeEach } from 'vitest';
import { compileOpenApi } from './openapi';
import { canonicalCapabilityId } from './identity';
import { sealManifest, validateManifest, type CapabilityManifest } from './manifest';
import { clearCapabilities } from './registry';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Board', version: '1' },
    servers: [{ url: 'https://board.example.test/v1' }],
    paths: {
        '/items': {
            get: {
                operationId: 'list',
                responses: { '200': { description: 'items', content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } } } }
            },
            post: {
                operationId: 'create',
                responses: { '204': { description: 'created' } }
            }
        }
    }
};

function atBase(baseUrl: string): CapabilityManifest {
    const compiled = compileOpenApi(SPEC).manifests.find(entry => entry.source.operationId === 'list')!;
    if (compiled.transport.kind !== 'http') throw new Error('expected http');
    const transport = { ...compiled.transport, baseUrl };
    return sealManifest({ ...compiled, id: canonicalCapabilityId(transport), transport });
}

beforeEach(() => {
    clearCapabilities();
});

describe('base URL policy', () => {
    it.each([
        ['https://board.example.test/v1?api_key=abc', 'query or fragment'],
        ['https://board.example.test/v1#x', 'query or fragment'],
        ['https://[::ffff:a9fe:a9fe]', 'non-public address'],
        ['https://[::ffff:10.0.0.1]', 'non-public address'],
        ['https://10.0.0.1', 'non-public address'],
        ['https://169.254.169.254', 'metadata service'],
        ['https://metadata.google.internal', 'metadata service'],
        ['http://127.0.0.1:8080', 'loopback only in a host-created manifest'],
        ['https://localhost', 'loopback only in a host-created manifest'],
        ['http://[::ffff:7f00:1]', 'loopback only in a host-created manifest'],
        ['http://board.example.test', 'must be https']
    ])('refuses %s', (baseUrl, reason) => {
        const result = validateManifest(atBase(baseUrl));
        expect(result.ok).toBe(false);
        expect(result.errors.join('; ')).toContain(reason);
    });

    it('accepts a public https base', () => {
        expect(validateManifest(atBase('https://board.example.test/v1')).ok).toBe(true);
        expect(validateManifest(atBase('https://1.1.1.1')).ok).toBe(true);
    });

    it('allows loopback http only when the host built the manifest', () => {
        const local = atBase('http://127.0.0.1:8080');
        expect(validateManifest(local).ok).toBe(false);
        expect(validateManifest(local, { hostCreated: true }).ok).toBe(true);
        expect(validateManifest(atBase('http://10.0.0.1'), { hostCreated: true }).ok).toBe(false);
    });

    it('does not compile an OpenAPI server URL that carries a query', () => {
        const compiled = compileOpenApi({ ...SPEC, servers: [{ url: 'https://board.example.test/v1?api_key=abc' }] });
        expect(compiled.manifests).toHaveLength(0);
        expect(compiled.errors.map(error => error.message).join('; ')).toContain('query or fragment');
    });
});
