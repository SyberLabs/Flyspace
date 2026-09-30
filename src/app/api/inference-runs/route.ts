// ============================================
// PROJECT OMNI: INFERENCE LEDGER READ API
// GET /api/inference-runs?limit=&provider=&status=
//
// The read side of the ledger. Postgres is reachable only from here and from
// /api/llm — DATABASE_URL is read in one server-only module and the browser
// asks OmniOS, exactly as it does for provider keys.
//
// Without DATABASE_URL this answers 200 with an empty list and
// `configured: false`, so a caller can tell "no ledger" from "no runs yet"
// without a failed request.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
    recentRuns,
    clampLimit,
    DEFAULT_RUN_LIMIT,
    type RunProvider,
    type RunStatus
} from '@/core/services/server/inference.ledger';
import { isDatabaseConfigured } from '@/core/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVIDERS = new Set<string>(['local', 'anthropic', 'google']);
const STATUSES = new Set<string>(['running', 'succeeded', 'failed', 'canceled', 'uncertain']);

export async function GET(request: NextRequest) {
    const params = request.nextUrl.searchParams;

    const provider = params.get('provider');
    if (provider !== null && !PROVIDERS.has(provider)) {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    const status = params.get('status');
    if (status !== null && !STATUSES.has(status)) {
        return NextResponse.json({ error: `Unknown status: ${status}` }, { status: 400 });
    }

    const rawLimit = params.get('limit');
    // A non-numeric limit is a caller bug worth naming, not a silent default.
    if (rawLimit !== null && !/^\d+$/.test(rawLimit)) {
        return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 });
    }
    const limit = rawLimit === null ? DEFAULT_RUN_LIMIT : clampLimit(Number(rawLimit));

    if (process.env.OMNI_PUBLIC_DEMO === '1' || !isDatabaseConfigured()) {
        return NextResponse.json(
            { configured: false, limit, runs: [] },
            { headers: { 'cache-control': 'no-store' } }
        );
    }

    try {
        const runs = await recentRuns({
            limit,
            provider: (provider ?? undefined) as RunProvider | undefined,
            status: (status ?? undefined) as RunStatus | undefined
        });
        return NextResponse.json(
            { configured: true, limit, runs },
            { headers: { 'cache-control': 'no-store' } }
        );
    } catch {
        // A connection string or host name could ride along on a pg error.
        console.error('[api/inference-runs] ledger query failed');
        return NextResponse.json({ error: 'Ledger query failed. Check server logs.' }, { status: 503 });
    }
}
