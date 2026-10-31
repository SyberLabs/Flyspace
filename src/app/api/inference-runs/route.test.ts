import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ recentRuns: vi.fn(), runLineage: vi.fn() }));
vi.mock('@/core/services/server/inference.ledger', async importOriginal => ({
    ...await importOriginal<typeof import('@/core/services/server/inference.ledger')>(),
    recentRuns: mocks.recentRuns,
    runLineage: mocks.runLineage
}));
vi.mock('@/core/db/client', () => ({ isDatabaseConfigured: () => true }));

import { GET as getRuns } from './route';
import { GET as getLineage } from './[id]/lineage/route';

// What a pg connection error can carry; it must reach neither the caller nor the log.
const CONNECTION_STRING = 'postgres://omni:hunter2@db.internal:5432/omni';

const savedDemo = process.env.OMNI_PUBLIC_DEMO;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    delete process.env.OMNI_PUBLIC_DEMO;
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    if (savedDemo === undefined) delete process.env.OMNI_PUBLIC_DEMO;
    else process.env.OMNI_PUBLIC_DEMO = savedDemo;
    vi.restoreAllMocks();
    mocks.recentRuns.mockReset();
    mocks.runLineage.mockReset();
});

describe('ledger read routes when the query fails', () => {
    it('GET /api/inference-runs answers the same 503 and keeps the pg error out of it', async () => {
        mocks.recentRuns.mockRejectedValue(new Error(`connect ECONNREFUSED ${CONNECTION_STRING}`));

        const response = await getRuns(new NextRequest('http://localhost/api/inference-runs?limit=5'));

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'Ledger query failed. Check server logs.' });
        expect(error.mock.calls).toEqual([['{"event":"flyspace.ledger.query_failed","query":"runs","kind":"Error"}']]);
    });

    it('GET /api/inference-runs/:id/lineage answers the same 503 and keeps the pg error out of it', async () => {
        mocks.runLineage.mockRejectedValue(new Error(`connect ECONNREFUSED ${CONNECTION_STRING}`));

        const response = await getLineage(
            new NextRequest('http://localhost/api/inference-runs/7/lineage'),
            { params: Promise.resolve({ id: '7' }) }
        );

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'Lineage query failed. Check server logs.' });
        expect(error.mock.calls).toEqual([['{"event":"flyspace.ledger.query_failed","query":"lineage","kind":"Error"}']]);
    });
});
