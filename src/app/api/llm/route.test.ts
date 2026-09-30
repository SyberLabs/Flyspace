import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runComplete: vi.fn(),
    runStream: vi.fn(),
    openRun: vi.fn(),
    checkProviderAvailable: vi.fn(),
    isProviderConfigured: vi.fn()
}));

vi.mock('@/core/services/server/llm.adapters', () => ({
    ProviderResponseError: class ProviderResponseError extends Error {
        readonly isDefinitiveRejection: boolean;
        constructor(message: string, readonly status: number) {
            super(message);
            this.isDefinitiveRejection = status >= 400 && status < 500 && status !== 408 && status !== 429;
        }
    },
    runComplete: mocks.runComplete,
    runStream: mocks.runStream,
    checkProviderAvailable: mocks.checkProviderAvailable,
    isProviderConfigured: mocks.isProviderConfigured
}));
vi.mock('@/core/services/server/inference.ledger', () => ({
    openRun: mocks.openRun,
    MAX_SOURCES: 64,
    normalizePostgresBigintId: (value: string) => {
        if (!/^\d{1,19}$/.test(value)) return undefined;
        const normalized = value.replace(/^0+(?=\d)/, '');
        if (normalized.length > 19 || (normalized.length === 19 && normalized > '9223372036854775807')) return undefined;
        return normalized;
    }
}));

import { POST } from './route';

function runHandle() {
    return {
        id: '101',
        succeeded: vi.fn(), failed: vi.fn(), canceled: vi.fn(), uncertain: vi.fn(),
        meter: (stream: ReadableStream<Uint8Array>, onCancel?: (reason?: unknown) => void) =>
            new ReadableStream<Uint8Array>({
                async pull(controller) {
                    const reader = stream.getReader();
                    const { done, value } = await reader.read();
                    if (done) controller.close(); else controller.enqueue(value);
                },
                async cancel(reason) { onCancel?.(reason); await stream.cancel(reason).catch(() => undefined); }
            })
    };
}

afterEach(() => {
    vi.clearAllMocks();
    delete process.env.OMNI_E2E;
});

describe('/api/llm total request deadline', () => {
    it('stops a stalled body when the caller disconnects without dispatching a provider', async () => {
        mocks.isProviderConfigured.mockReturnValue(true);
        const abort = new AbortController();
        const body = new ReadableStream<Uint8Array>({ start() { /* remains open */ } });
        const request = new Request('http://localhost/api/llm', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body,
            signal: abort.signal, duplex: 'half'
        } as RequestInit & { duplex: 'half' });
        const pending = POST(request as never);
        abort.abort();
        const response = await pending;
        expect(response.status).toBe(499);
        expect(mocks.openRun).not.toHaveBeenCalled();
        expect(mocks.runComplete).not.toHaveBeenCalled();
    });

    it('does not dispatch when durable admission misses the total deadline', async () => {
        mocks.isProviderConfigured.mockReturnValue(true);
        let admit!: (value: ReturnType<typeof runHandle>) => void;
        mocks.openRun.mockReturnValue(new Promise(resolve => { admit = resolve; }));
        const abort = new AbortController();
        const request = new Request('http://localhost/api/llm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] }),
            signal: abort.signal
        });
        const pending = POST(request as never);
        while (!mocks.openRun.mock.calls.length) await new Promise(resolve => setTimeout(resolve, 0));
        abort.abort();
        expect((await pending).status).toBe(499);
        expect(mocks.runComplete).not.toHaveBeenCalled();
        admit(runHandle());
    });

    it('marks transport failure uncertain without misreporting it as a timeout', async () => {
        const run = runHandle();
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(run);
        mocks.runComplete.mockRejectedValue(new TypeError('connection refused'));
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining('outcome may be unresolved') });
        expect(run.uncertain).toHaveBeenCalledOnce();
        expect(run.failed).not.toHaveBeenCalled();
    });

    it.each([408, 429, 500, 503])('marks provider HTTP %i as unresolved', async status => {
        const run = runHandle();
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(run);
        const { ProviderResponseError } = await import('@/core/services/server/llm.adapters');
        mocks.runComplete.mockRejectedValue(new ProviderResponseError(`HTTP ${status}`, status));
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(502);
        expect(run.uncertain).toHaveBeenCalledOnce();
        expect(run.failed).not.toHaveBeenCalled();
    });

    it.each([400, 401, 403, 422])('records provider HTTP %i as a definitive failure', async status => {
        const run = runHandle();
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(run);
        const { ProviderResponseError } = await import('@/core/services/server/llm.adapters');
        mocks.runComplete.mockRejectedValue(new ProviderResponseError(`HTTP ${status}`, status));
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(502);
        expect(run.failed).toHaveBeenCalledOnce();
        expect(run.uncertain).not.toHaveBeenCalled();
    });
});
