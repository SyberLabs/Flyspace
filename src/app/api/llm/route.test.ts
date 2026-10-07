import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    runComplete: vi.fn(),
    runStream: vi.fn(),
    openRun: vi.fn(),
    authenticateApiRequest: vi.fn(),
    hostedAuthRequired: vi.fn(),
    checkProviderAvailable: vi.fn(),
    isProviderConfigured: vi.fn()
}));

vi.mock('@/core/services/server/auth', () => ({
    authenticateApiRequest: mocks.authenticateApiRequest,
    hostedAuthRequired: mocks.hostedAuthRequired
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
    providerStreams: (provider: string) => provider === 'local',
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
        id: '101', replay: false, idempotencyConflict: false,
        succeeded: vi.fn(), failed: vi.fn(), canceled: vi.fn(), uncertain: vi.fn(),
        meter: (stream: ReadableStream<Uint8Array>, onCancel?: (reason?: unknown) => void) =>
            new ReadableStream<Uint8Array>({
                async pull(controller) {
                    const reader = stream.getReader();
                    const { done, value } = await reader.read();
                    reader.releaseLock();
                    if (done) controller.close(); else controller.enqueue(value);
                },
                async cancel(reason) { onCancel?.(reason); await stream.cancel(reason).catch(() => undefined); }
            })
    };
}

afterEach(() => {
    vi.clearAllMocks();
    delete process.env.OMNI_E2E;
    delete process.env.OMNI_DEPLOYMENT_MODE;
});

describe('/api/llm total request deadline', () => {
    it('stops a stalled body when the caller disconnects without dispatching a provider', async () => {
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        const abort = new AbortController();
        const body = new ReadableStream<Uint8Array>({ start() { /* remains open */ } });
        const request = new Request('http://localhost/api/llm', {
            method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' }, body,
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
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        let admit!: (value: ReturnType<typeof runHandle>) => void;
        mocks.openRun.mockReturnValue(new Promise(resolve => { admit = resolve; }));
        const abort = new AbortController();
        const request = new Request('http://localhost/api/llm', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'content-type': 'application/json' },
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
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(run);
        mocks.runComplete.mockRejectedValue(new TypeError('connection refused'));
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(502);
        expect(await response.json()).toMatchObject({ error: expect.stringContaining('outcome may be unresolved') });
        expect(run.uncertain).toHaveBeenCalledOnce();
        expect(run.failed).not.toHaveBeenCalled();
    });

    it.each([408, 429, 500, 503])('marks provider HTTP %i as unresolved', async status => {
        const run = runHandle();
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(run);
        const { ProviderResponseError } = await import('@/core/services/server/llm.adapters');
        mocks.runComplete.mockRejectedValue(new ProviderResponseError(`HTTP ${status}`, status));
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(502);
        expect(run.uncertain).toHaveBeenCalledOnce();
        expect(run.failed).not.toHaveBeenCalled();
    });

    it.each([400, 401, 403, 422])('records provider HTTP %i as a definitive failure', async status => {
        const run = runHandle();
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(run);
        const { ProviderResponseError } = await import('@/core/services/server/llm.adapters');
        mocks.runComplete.mockRejectedValue(new ProviderResponseError(`HTTP ${status}`, status));
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(502);
        expect(run.failed).toHaveBeenCalledOnce();
        expect(run.uncertain).not.toHaveBeenCalled();
    });

    it('fails hosted admission closed when the ledger cannot return a durable run', async () => {
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: 'issuer:alice' } });
        mocks.hostedAuthRequired.mockReturnValue(true);
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue({ id: null }); // no database, failed open, or active cooldown
        const response = await POST(new Request('http://localhost/api/llm', {
            method: 'POST',
            headers: { origin: 'http://localhost', 'content-type': 'application/json', 'idempotency-key': 'op-1' },
            body: JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] })
        }) as never);
        expect(response.status).toBe(503);
        expect(mocks.runComplete).not.toHaveBeenCalled();
        expect(mocks.runStream).not.toHaveBeenCalled();
    });
});

describe('/api/llm records whether the answer actually streamed', () => {
    function streamRequest(provider: string) {
        return new Request('http://localhost/api/llm', {
            method: 'POST', headers: { origin: 'http://localhost', 'content-type': 'application/json' },
            body: JSON.stringify({ provider, model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }] })
        });
    }

    function oneChunk(text: string) {
        return new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); }
        });
    }

    it('records streamed: true for the local provider, whose bytes pass through', async () => {
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(runHandle());
        mocks.runStream.mockResolvedValue(oneChunk('ok'));
        const response = await POST(streamRequest('local') as never);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok');
        expect(mocks.openRun).toHaveBeenCalledWith(expect.objectContaining({ provider: 'local', streamed: true }));
    });

    it.each(['anthropic', 'google'])('records streamed: false for %s, which is buffered into one chunk', async provider => {
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        mocks.isProviderConfigured.mockReturnValue(true);
        mocks.openRun.mockResolvedValue(runHandle());
        mocks.runStream.mockResolvedValue(oneChunk('ok'));
        const response = await POST(streamRequest(provider) as never);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok');
        expect(mocks.runStream).toHaveBeenCalledOnce();
        expect(mocks.openRun).toHaveBeenCalledWith(expect.objectContaining({ provider, streamed: false }));
    });
});

describe('/api/llm request admission', () => {
    const body = JSON.stringify({ provider: 'anthropic', model: 'claude', messages: [{ role: 'user', content: 'hi' }] });
    const llmRequest = (headers: Record<string, string>) =>
        new Request('http://localhost/api/llm', { method: 'POST', headers, body });

    it('refuses a cross-site Origin before auth or any body read', async () => {
        const response = await POST(llmRequest({ origin: 'https://evil.example', 'content-type': 'application/json' }) as never);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Request must come from this site.' });
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
        expect(mocks.openRun).not.toHaveBeenCalled();
        expect(mocks.runComplete).not.toHaveBeenCalled();
    });

    it('refuses a request with no Origin, as the broker does', async () => {
        const response = await POST(llmRequest({ 'content-type': 'application/json' }) as never);
        expect(response.status).toBe(403);
        expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
        expect(mocks.runComplete).not.toHaveBeenCalled();
    });

    it('refuses a same-site request whose body is not application/json', async () => {
        const response = await POST(llmRequest({ origin: 'http://localhost', 'content-type': 'text/plain' }) as never);
        expect(response.status).toBe(415);
        expect(await response.json()).toEqual({ error: 'Content-Type must be application/json.' });
        expect(mocks.authenticateApiRequest).not.toHaveBeenCalled();
        expect(mocks.runComplete).not.toHaveBeenCalled();
    });

    it('passes a same-site JSON request on to authentication', async () => {
        mocks.authenticateApiRequest.mockResolvedValue({
            response: NextResponseLike(401, { error: 'Authentication required' })
        });
        const response = await POST(llmRequest({ origin: 'http://localhost', 'content-type': 'application/json; charset=utf-8' }) as never);
        expect(mocks.authenticateApiRequest).toHaveBeenCalledOnce();
        expect(response.status).toBe(401);
        expect(mocks.runComplete).not.toHaveBeenCalled();
    });

    it('keeps the public-demo gate ahead of the origin check', async () => {
        const saved = process.env.OMNI_PUBLIC_DEMO;
        process.env.OMNI_PUBLIC_DEMO = '1';
        try {
            const response = await POST(llmRequest({}) as never);
            expect(response.status).toBe(503);
        } finally {
            if (saved === undefined) delete process.env.OMNI_PUBLIC_DEMO;
            else process.env.OMNI_PUBLIC_DEMO = saved;
        }
    });

    it('still serves the e2e double to a same-site request', async () => {
        process.env.OMNI_E2E = '1';
        process.env.OMNI_DEPLOYMENT_MODE = 'local';
        mocks.authenticateApiRequest.mockResolvedValue({ identity: { ownerId: null } });
        mocks.hostedAuthRequired.mockReturnValue(false);
        const response = await POST(llmRequest({ origin: 'http://localhost', 'content-type': 'application/json' }) as never);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ content: expect.stringContaining('E2E MOCK RESPONSE') });
        expect(mocks.runComplete).not.toHaveBeenCalled();
    });
});

function NextResponseLike(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
