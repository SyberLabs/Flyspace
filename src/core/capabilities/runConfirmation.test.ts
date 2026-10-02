import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compileOpenApi } from './openapi';
import { approveCapability, clearCapabilities, installProposal } from './registry';
import { executeCapability, previewCapabilityRun } from './execute';
import { resolveHttpPath } from './httpTarget';

const SPEC = {
    openapi: '3.0.3',
    info: { title: 'Ledger', version: '1' },
    servers: [{ url: 'https://ledger.example.test/v1' }],
    paths: {
        '/accounts/{id}/transfer': {
            post: {
                operationId: 'transfer',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    required: true,
                    content: { 'application/json': { schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'number' } } } } }
                },
                responses: { '204': { description: 'sent' } }
            }
        },
        '/accounts/{id}': {
            get: {
                operationId: 'account',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': { description: 'account', content: { 'application/json': { schema: { type: 'object' } } } }
                }
            }
        },
        '/files/{name}.{ext}/archive': {
            post: {
                operationId: 'archive',
                parameters: [
                    { name: 'name', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'ext', in: 'path', required: true, schema: { type: 'string' } }
                ],
                responses: { '204': { description: 'archived' } }
            }
        }
    }
};

function install(operationId: string) {
    const manifest = compileOpenApi(SPEC).manifests.find(entry => entry.source.operationId === operationId);
    if (!manifest) throw new Error(`fixture ${operationId} did not compile`);
    expect(installProposal(manifest).ok).toBe(true);
    if (manifest.effect === 'write' || manifest.effect === 'destructive') approveCapability(manifest.id);
    return manifest.id;
}

function stubFetch() {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

beforeEach(() => {
    clearCapabilities();
    vi.unstubAllGlobals();
});

describe('path arguments', () => {
    it.each(['..', '.'])('refuses %s as a path value and never fetches', async (value) => {
        const fetchMock = stubFetch();
        const read = install('account');
        const result = await executeCapability(read, { id: value });
        expect(result.error?.code).toBe('INPUT_INVALID');
        expect(fetchMock).not.toHaveBeenCalled();

        const write = install('transfer');
        const preview = previewCapabilityRun(write, { id: value, body: { amount: 1 } });
        expect(preview.ok).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses arguments that would let URL normalization change the path', () => {
        const target = resolveHttpPath('https://ledger.example.test/v1', '/files/{name}.{ext}/archive', { name: '', ext: '' });
        expect('error' in target).toBe(true);
        const fine = resolveHttpPath('https://ledger.example.test/v1', '/files/{name}.{ext}/archive', { name: 'report', ext: 'pdf' });
        expect('url' in fine && fine.url.pathname).toBe('/v1/files/report.pdf/archive');
    });

    it('resolves to exactly the expanded template', () => {
        const write = install('transfer');
        const preview = previewCapabilityRun(write, { id: 'acct 1/2', body: { amount: 5 } });
        expect(preview.ok).toBe(true);
        if (!preview.ok) return;
        expect(preview.preview.url).toBe('https://ledger.example.test/v1/accounts/acct%201%2F2/transfer');
        expect(preview.preview.method).toBe('POST');
        expect(preview.preview.arguments).toEqual({ id: 'acct 1/2', body: { amount: 5 } });
    });
});

describe('write confirmation', () => {
    it('does not dispatch a write until its preview is confirmed, then dispatches once', async () => {
        const fetchMock = stubFetch();
        const write = install('transfer');
        const input = { id: 'acct-1', body: { amount: 5 } };

        const unconfirmed = await executeCapability(write, input, { idempotencyKey: 'transfer-key-1' });
        expect(unconfirmed.error?.code).toBe('CONFIRMATION_REQUIRED');
        expect(fetchMock).not.toHaveBeenCalled();

        const preview = previewCapabilityRun(write, input);
        if (!preview.ok) throw new Error('preview failed');
        const confirmed = await executeCapability(write, input, { idempotencyKey: 'transfer-key-1', confirmedRun: preview.preview.digest });
        expect(confirmed.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe(preview.preview.url);
    });

    it('refuses a confirmation for different arguments than the ones sent', async () => {
        const fetchMock = stubFetch();
        const write = install('transfer');
        const shown = previewCapabilityRun(write, { id: 'acct-1', body: { amount: 5 } });
        if (!shown.ok) throw new Error('preview failed');
        const changed = await executeCapability(write, { id: 'acct-2', body: { amount: 5 } }, { confirmedRun: shown.preview.digest });
        expect(changed.error?.code).toBe('CONFIRMATION_REQUIRED');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves read capabilities unconfirmed', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        const read = install('account');
        const result = await executeCapability(read, { id: 'acct-1' });
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
