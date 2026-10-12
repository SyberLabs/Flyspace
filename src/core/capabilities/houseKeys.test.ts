import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { curatedApi } from './curatedApis';
import { executeCapability } from './execute';
import { houseKeyCovers, loadHouseKeys, setHouseKeysForTests } from './houseKeys';
import type { CapabilityManifest } from './manifest';
import { compileOpenApi } from './openapi';
import { clearCapabilities, installProposal } from './registry';
import { capabilitySecrets } from './secrets';

function fredSeries(): CapabilityManifest {
    const fred = curatedApi('omni:fred')!;
    const manifest = compileOpenApi(fred.spec, { sourceLocator: fred.entry.specUrl, brokerOrigins: fred.brokerOrigins }).manifests
        .find(entry => entry.inputs.some(input => input.name === 'series_id' && input.required));
    if (!manifest) throw new Error('no FRED series operation');
    return manifest;
}

const INPUT = { file_type: 'json', series_id: 'UNRATE' };

beforeEach(() => {
    clearCapabilities();
    capabilitySecrets.clear();
    setHouseKeysForTests([]);
});

afterEach(() => {
    vi.unstubAllGlobals();
    setHouseKeysForTests([]);
});

describe('house-key coverage in the browser', () => {
    it('reads the digests the server covers, and keeps only well-formed ones', async () => {
        const manifest = fredSeries();
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ apis: ['omni:fred'], digests: [manifest.digest, 'not-a-digest'] })));
        await loadHouseKeys(fetchImpl as unknown as typeof fetch);
        expect(houseKeyCovers(manifest)).toBe(true);
    });

    it('covers nothing when the server cannot be asked', async () => {
        await loadHouseKeys((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
        expect(houseKeyCovers(fredSeries())).toBe(false);
    });

    it('runs a covered curated API with no key entered, sending no secret to the broker', async () => {
        const manifest = fredSeries();
        expect(installProposal(manifest).ok).toBe(true);
        setHouseKeysForTests([manifest.digest]);
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
            void init;
            return new Response(JSON.stringify({
                runId: 'run_x', executionStatus: 'succeeded',
                value: { observations: [{ date: '2026-09-01', value: '4.1' }] },
                served: { key: 'house', cached: false, fetchedAt: '2026-10-12T00:00:00.000Z' }
            }), { status: 200, headers: { 'content-type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await executeCapability(manifest.id, INPUT);
        expect(result.error).toBeUndefined();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/capability-broker');
        expect(JSON.parse(String(init?.body))).not.toHaveProperty('secret');
    });

    it('still asks for a key when the server does not cover the manifest', async () => {
        const manifest = fredSeries();
        expect(installProposal(manifest).ok).toBe(true);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const result = await executeCapability(manifest.id, INPUT);
        expect(result.error?.code).toBe('AUTH_UNBOUND');
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
