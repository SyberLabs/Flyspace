import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as postLlm } from './llm/route';
import { GET as getRuns } from './inference-runs/route';
import { GET as getLineage } from './inference-runs/[id]/lineage/route';

const savedDemo = process.env.OMNI_PUBLIC_DEMO;
const savedDatabase = process.env.DATABASE_URL;

afterEach(() => {
    if (savedDemo === undefined) delete process.env.OMNI_PUBLIC_DEMO;
    else process.env.OMNI_PUBLIC_DEMO = savedDemo;
    if (savedDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabase;
    vi.unstubAllGlobals();
});

describe('public demo server boundary', () => {
    it('blocks the paid LLM route before making upstream calls', async () => {
        process.env.OMNI_PUBLIC_DEMO = '1';
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const llm = await postLlm(new NextRequest('https://omni.syberlabs.io/api/llm', {
            method: 'POST', body: '{}'
        }));

        expect(llm.status).toBe(503);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns empty ledger views even if a database secret exists', async () => {
        process.env.OMNI_PUBLIC_DEMO = '1';
        process.env.DATABASE_URL = 'postgres://user:secret@localhost:5432/omni';

        const runs = await getRuns(new NextRequest('https://omni.syberlabs.io/api/inference-runs'));
        const lineage = await getLineage(
            new NextRequest('https://omni.syberlabs.io/api/inference-runs/1/lineage'),
            { params: Promise.resolve({ id: '1' }) }
        );

        expect(runs.status).toBe(200);
        expect(await runs.json()).toEqual(expect.objectContaining({ configured: false, runs: [] }));
        expect(lineage.status).toBe(200);
        expect(await lineage.json()).toEqual(expect.objectContaining({ configured: false, root: null, nodes: [] }));
    });
});
