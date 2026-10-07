import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const BODY_MARKER = 'UPSTREAM-BODY-MUST-NOT-BE-LOGGED';

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

async function failureOf(response: Response) {
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.success).toBe(false);
    return body.error as string;
}

describe('GET /api/polymarket', () => {
    it('maps a Gamma market list to the block shape', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json([{
            id: 'mkt-1',
            question: 'Will it rain?',
            outcomes: '["Yes","No"]',
            outcomePrices: '["0.65","0.35"]',
            volumeNum: 12345
        }])));
        const response = await GET();
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.markets).toHaveLength(1);
        expect(body.markets[0].outcomes[0]).toEqual({ id: 'mkt-1_0', name: 'Yes', probability: 0.65 });
        expect(body.markets[0].volume).toBe(12345);
    });

    it('reports an upstream 500 as a failure, not an empty success', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(BODY_MARKER, { status: 500 })));
        expect(await failureOf(await GET())).toBe('upstream_status');
        expect(warn).toHaveBeenCalledWith('[Polymarket API] upstream returned', 500);
    });

    it('reports an unexpected shape as a failure and logs keys, never the body', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ surprise: BODY_MARKER, nested: { secret: BODY_MARKER } })));
        expect(await failureOf(await GET())).toBe('upstream_shape');
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).not.toContain(BODY_MARKER);
        expect(logged).toContain('surprise');
    });

    it('keeps the body out of the log when upstream returns non-JSON', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${BODY_MARKER}</html>`, {
            status: 200, headers: { 'content-type': 'text/html' }
        })));
        expect(await failureOf(await GET())).toBe('upstream_unreachable');
        expect(JSON.stringify(warn.mock.calls)).not.toContain(BODY_MARKER);
    });

    it('bounds the upstream fetch and reports a timeout as a failure', async () => {
        const timeout = AbortSignal.timeout;
        const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => timeout(ms));
        vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
            expect(init?.signal).toBeInstanceOf(AbortSignal);
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
        }));
        expect(await failureOf(await GET())).toBe('upstream_timeout');
        expect(timeoutSpy).toHaveBeenCalledWith(8000);
    });
});
