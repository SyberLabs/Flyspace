// ============================================
// PROJECT OMNI: RUN LINEAGE
// GET /api/inference-runs/:id/lineage?depth=
//
// Everything that made one answer: the run, the runs whose answers fed it,
// and the raw sources at every level.
//
// This is the question the canvas cannot answer. Source chips show one hop,
// and a cascade's real grounding is several hops back — by which time the
// upstream blocks have refetched and the evidence is gone. The server kept it.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { runLineage, clampDepth, DEFAULT_LINEAGE_DEPTH } from '@/core/services/server/inference.ledger';
import { isDatabaseConfigured } from '@/core/db/client';
import { authenticateApiRequest } from '@/core/services/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `inference_run.id` is a bigint; only digits can name one. */
const RUN_ID = /^\d{1,19}$/;

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await authenticateApiRequest(request);
    if (auth.response) return auth.response;
    const { id } = await context.params;
    if (!RUN_ID.test(id)) {
        return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    }

    const rawDepth = request.nextUrl.searchParams.get('depth');
    if (rawDepth !== null && !/^\d+$/.test(rawDepth)) {
        return NextResponse.json({ error: 'depth must be a non-negative integer' }, { status: 400 });
    }
    const depth = rawDepth === null ? DEFAULT_LINEAGE_DEPTH : clampDepth(Number(rawDepth));

    if (process.env.OMNI_PUBLIC_DEMO === '1' || !isDatabaseConfigured()) {
        return NextResponse.json(
            { configured: false, depth, root: null, nodes: [], hadCycle: false, truncated: false },
            { headers: { 'cache-control': 'no-store' } }
        );
    }

    try {
        const lineage = await runLineage(id, depth, auth.identity.ownerId);
        // An unknown id and a run with no lineage are different answers.
        if (!lineage.root) {
            return NextResponse.json({ error: `No run ${id}` }, { status: 404 });
        }
        return NextResponse.json(
            { configured: true, depth, ...lineage },
            { headers: { 'cache-control': 'no-store' } }
        );
    } catch {
        // A connection string or host name could ride along on a pg error.
        console.error('[api/inference-runs/lineage] query failed');
        return NextResponse.json({ error: 'Lineage query failed. Check server logs.' }, { status: 503 });
    }
}
