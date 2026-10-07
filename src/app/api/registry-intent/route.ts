// ============================================
// POST /api/registry-intent  { query }
//
// JEV intent routing for the API registry search. Returns
// `{ scores: [{ id, p }], model }` or a 503/502 that the client treats as
// "show keyword results", which is a complete answer on its own.
//
// Off unless explicitly enabled: OMNI_REGISTRY_JEV_ENABLED=1 is the decision
// to send search text to TypeSafe, and TYPESAFE_API_KEY is the server-side
// credential for it. Always off in the public preview.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { readBoundedJson, RequestBodyTooLarge } from '@/core/services/server/boundedJson';
import { requireSameOrigin } from '@/core/services/server/sameOrigin';
import { classifyIntent } from '@/core/services/server/registryIntent';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 2048;

function reply(status: number, body: Record<string, unknown>): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
}

export async function POST(request: NextRequest) {
    if (process.env.OMNI_PUBLIC_DEMO === '1'
        || process.env.OMNI_REGISTRY_JEV_ENABLED !== '1'
        || !process.env.TYPESAFE_API_KEY) {
        return reply(503, { error: 'Search routing is unavailable.' });
    }
    const refusal = requireSameOrigin(request);
    if (refusal) return refusal;

    let body: unknown;
    try {
        body = await readBoundedJson(request, AbortSignal.any([request.signal, AbortSignal.timeout(5000)]), MAX_BODY_BYTES);
    } catch (err) {
        return reply(err instanceof RequestBodyTooLarge ? 413 : 400, { error: 'Invalid request.' });
    }
    const query = body && typeof body === 'object' ? (body as { query?: unknown }).query : undefined;

    const outcome = await classifyIntent(query, { signal: request.signal });
    if (outcome.ok) return reply(200, { scores: outcome.scores, model: outcome.model });
    if (outcome.failure === 'query_invalid') return reply(400, { error: 'Query must be 1–200 characters.' });
    if (outcome.failure === 'not_configured') return reply(503, { error: 'Search routing is unavailable.' });
    // Status and failure code only; never the query or the upstream body.
    console.warn('[registry-intent] upstream failure', { failure: outcome.failure });
    return reply(502, { error: 'Search routing failed.' });
}
