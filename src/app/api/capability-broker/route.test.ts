import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const handler = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ status: 200, body: { ok: true } })));
const validate = vi.hoisted(() => vi.fn());

vi.mock('@/core/services/server/capabilityBroker', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/core/services/server/capabilityBroker')>()),
    handleCapabilityBroker: handler
}));
vi.mock('@/core/capabilities/manifest', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/capabilities/manifest')>();
    return {
        ...actual,
        validateManifest: (...args: Parameters<typeof actual.validateManifest>) => {
            validate(...args);
            return actual.validateManifest(...args);
        }
    };
});

import { POST } from './route';

const SITE = 'http://localhost:3000';
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDemo = process.env.OMNI_PUBLIC_DEMO;

function brokerRequest(body: string, headers: Record<string, string>): NextRequest {
    return new NextRequest(`${SITE}/api/capability-broker`, { method: 'POST', headers, body });
}

beforeEach(() => {
    delete process.env.DATABASE_URL;
    delete process.env.OMNI_PUBLIC_DEMO;
    handler.mockClear();
    validate.mockClear();
});

afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalDemo === undefined) delete process.env.OMNI_PUBLIC_DEMO;
    else process.env.OMNI_PUBLIC_DEMO = originalDemo;
});

describe('/api/capability-broker request admission', () => {
    it('refuses a cross-site Origin before reading the body', async () => {
        const response = await POST(brokerRequest('{}', { origin: 'https://evil.example', 'content-type': 'application/json' }));
        expect(response.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('refuses a request with no Origin', async () => {
        const response = await POST(brokerRequest('{}', { 'content-type': 'application/json' }));
        expect(response.status).toBe(403);
        expect(handler).not.toHaveBeenCalled();
    });

    it('refuses a text/plain body', async () => {
        const response = await POST(brokerRequest('{}', { origin: SITE, 'content-type': 'text/plain' }));
        expect(response.status).toBe(415);
        expect(handler).not.toHaveBeenCalled();
    });

    it('answers 413 to a 2 MB body before any manifest is validated', async () => {
        const body = JSON.stringify({ manifest: {}, input: { pad: 'x'.repeat(2 * 1024 * 1024) }, idempotencyKey: 'broker-key-big' });
        const response = await POST(brokerRequest(body, { origin: SITE, 'content-type': 'application/json' }));
        expect(response.status).toBe(413);
        expect(handler).not.toHaveBeenCalled();
        expect(validate).not.toHaveBeenCalled();
    });

    it('passes a same-origin JSON request to the broker with an abort signal', async () => {
        const response = await POST(brokerRequest('{"manifest":{}}', { origin: SITE, 'content-type': 'application/json; charset=utf-8' }));
        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledTimes(1);
        const deps = handler.mock.calls[0][1] as { signal?: AbortSignal };
        expect(deps.signal).toBeInstanceOf(AbortSignal);
    });
});
