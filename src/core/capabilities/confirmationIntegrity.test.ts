import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { canonicalCapabilityId, credentialSlot } from './identity';
import { sealManifest, validateManifest, type CapabilityInput, type CapabilityManifest } from './manifest';
import { approveCapability, clearCapabilities, installProposal } from './registry';
import { bindMcpTransport, executeCapability, previewCapabilityRun, unbindMcpTransport } from './execute';
import { admitProposal } from './admission';
import type { CapabilityProposalV1 } from './provider';
import { capabilitySecrets } from './secrets';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Ledger', version: '1' },
    servers: [{ url: 'https://ledger.example.test/v1' }],
    paths: {
        '/accounts/{id}/notes': {
            post: {
                operationId: 'note',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'tag', in: 'query', required: false, schema: { type: 'string' } },
                    { name: 'X-Trace', in: 'header', required: false, schema: { type: 'string' } }
                ],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', properties: { text: { type: 'string' } } } } }
                },
                responses: { '204': { description: 'stored' } }
            }
        }
    }
};

function writeWithInputs(inputs: CapabilityInput[]): CapabilityManifest {
    const compiled = compileOpenApi(SPEC).manifests[0];
    if (compiled.transport.kind !== 'http') throw new Error('expected http');
    const transport = { ...compiled.transport, path: '/accounts/notes' };
    return sealManifest({ ...compiled, id: canonicalCapabilityId(transport), transport, inputs });
}

const RESERVED = ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty', 'valueOf'];

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    vi.unstubAllGlobals();
});

describe('reserved input names', () => {
    it.each(RESERVED)('a manifest cannot declare an input named %s', (name) => {
        const manifest = writeWithInputs([{ name, in: 'body', required: true, schema: { kind: 'object' } }]);
        const validated = validateManifest(manifest);
        expect(validated.ok).toBe(false);
        expect(validated.errors.join('; ')).toContain('reserved');
        expect(installProposal(manifest).ok).toBe(false);
    });

    it('an apiKey placement cannot use a reserved name', () => {
        const base = writeWithInputs([]);
        if (base.transport.kind !== 'http') throw new Error('expected http');
        const auth = { kind: 'apiKey' as const, in: 'header' as const, name: '__proto__' };
        const manifest = sealManifest({ ...base, auth: { ...auth, secretRef: credentialSlot(base.transport.baseUrl, auth) } });
        expect(validateManifest(manifest).errors.join('; ')).toContain('reserved');
    });

    it('a run supplying an inherited or reserved key as input is refused, not dropped', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const manifest = compileOpenApi(SPEC).manifests[0];
        installProposal(manifest);
        approveCapability(manifest.id);
        const input = JSON.parse('{"id":"a1","body":{"text":"hi"},"__proto__":{"text":"other"}}') as Record<string, unknown>;
        const preview = previewCapabilityRun(manifest.id, input);
        expect(preview.ok).toBe(false);
        const result = await executeCapability(manifest.id, input);
        expect(result.error?.code).toBe('INPUT_INVALID');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('the confirmed request is the dispatched request', () => {
    function installNote() {
        const manifest = compileOpenApi(SPEC).manifests[0];
        expect(installProposal(manifest).ok).toBe(true);
        approveCapability(manifest.id);
        return manifest.id;
    }

    it('changing any serialized value changes the confirmation digest', () => {
        const id = installNote();
        const base = { id: 'a1', tag: 't', 'X-Trace': 'x', body: { text: 'hi' } };
        const digest = (input: Record<string, unknown>) => {
            const preview = previewCapabilityRun(id, input);
            if (!preview.ok) throw new Error(preview.result.error?.message);
            return preview.preview.digest;
        };
        const original = digest(base);
        expect(digest({ ...base, id: 'a2' })).not.toBe(original);
        expect(digest({ ...base, tag: 'u' })).not.toBe(original);
        expect(digest({ ...base, 'X-Trace': 'y' })).not.toBe(original);
        expect(digest({ ...base, body: { text: 'bye' } })).not.toBe(original);
        expect(digest({ ...base, body: { text: 'hi', extra: 1 } })).not.toBe(original);
    });

    it('sends exactly the URL, header and body the preview showed', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
        vi.stubGlobal('fetch', fetchMock);
        const id = installNote();
        const input = { id: 'a 1', tag: 'q&a', 'X-Trace': 'trace-9', body: { text: 'hello', nested: { n: 2 } } };
        const preview = previewCapabilityRun(id, input);
        if (!preview.ok) throw new Error('preview failed');
        const result = await executeCapability(id, input, { confirmedRun: preview.preview.digest });
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(preview.preview.url);
        expect(init?.body).toBe(JSON.stringify(preview.preview.arguments.body));
        expect((init?.headers as Record<string, string>)['X-Trace']).toBe(preview.preview.arguments['X-Trace']);
        // The preview lists every declared input that was supplied, and nothing else.
        expect(Object.keys(preview.preview.arguments).sort()).toEqual(['X-Trace', 'body', 'id', 'tag']);
        expect(Object.getPrototypeOf(preview.preview.arguments)).toBeNull();
    });

    it('refuses a reserved key nested inside a value instead of sending it unseen', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        // An open object schema: any other own key in the body is data to be sent.
        const open = writeWithInputs([{ name: 'payload', in: 'body', required: true, schema: { kind: 'object' } }]);
        expect(installProposal(open).ok).toBe(true);
        approveCapability(open.id);
        const input = { payload: JSON.parse('{"text":"hi","__proto__":{"amount":1}}') as unknown };
        const preview = previewCapabilityRun(open.id, input);
        expect(preview.ok).toBe(false);
        const result = await executeCapability(open.id, input);
        expect(result.error?.code).toBe('INPUT_INVALID');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hands a tool exactly the confirmed arguments', async () => {
        const proposal: CapabilityProposalV1 = {
            version: 1,
            provider: { id: 'fixture.mcp', kind: 'mcp' },
            externalIdentity: { operationId: 'post', sourceLocator: 'fixture://mcp/board' },
            title: 'Post',
            auth: { kind: 'none' },
            transport: { kind: 'mcp', serverId: 'board', origin: 'https://board.example.test', toolName: 'post' },
            inputs: [
                { name: 'channel', in: 'argument', required: true, schema: { kind: 'string' } },
                { name: 'message', in: 'argument', required: true, schema: { kind: 'object' } }
            ],
            output: { schema: { kind: 'null' }, presentation: 'raw' },
            execution: { kind: 'sync' },
            provenance: { providerId: 'fixture.mcp', sourceLocator: 'fixture://mcp/board', discoveredAtMs: 1_790_000_000_000 }
        };
        const installed = admitProposal(proposal, { nowMs: 1_790_000_000_000 });
        expect(installed.ok, installed.errors.join('; ')).toBe(true);
        const manifest = approveCapability(installed.manifest!.id).manifest!;
        const received: Array<Record<string, unknown>> = [];
        bindMcpTransport('board', { origin: 'https://board.example.test', call: async (_server, _tool, args) => { received.push(args); return null; } });
        try {
            const input = { channel: 'ops', message: { text: 'deploy' } };
            const preview = previewCapabilityRun(manifest.id, input);
            if (!preview.ok) throw new Error('preview failed');
            const result = await executeCapability(manifest.id, input, { confirmedRun: preview.preview.digest });
            expect(result.ok).toBe(true);
            expect(received).toHaveLength(1);
            expect(Object.getPrototypeOf(received[0])).toBeNull();
            expect(JSON.stringify(received[0])).toBe(JSON.stringify(preview.preview.arguments));
        } finally {
            unbindMcpTransport('board');
        }
    });
});
