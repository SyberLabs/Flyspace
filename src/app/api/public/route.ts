// ============================================
// KEYLESS PUBLIC PROXY
// GET /api/public?provider=<id>&...params
//
// Only the allowlisted demo APIs. No env vars are read. A 2xx JSON upstream
// body is returned verbatim so client adapters stay unchanged. The upstream
// hop is bounded (8 s deadline, 1 MB body, redirects not followed) and any
// upstream failure is a 502 `{ error: { code, message } }`, never a 200 with
// empty data. See public.providers.ts.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
    fetchPublicProvider,
    isPublicProvider,
    PUBLIC_PROXY_IDS
} from '@/core/services/server/public.providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function collectParams(request: NextRequest): Record<string, string | undefined> {
    const params: Record<string, string | undefined> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
        if (key !== 'provider') params[key] = value;
    });
    return params;
}

export async function GET(request: NextRequest) {
    const provider = request.nextUrl.searchParams.get('provider') || '';

    if (!isPublicProvider(provider)) {
        return NextResponse.json(
            {
                error: `Unknown or keyed provider: ${provider || '(missing)'}`,
                supported: PUBLIC_PROXY_IDS
            },
            { status: 400 }
        );
    }

    const { status, body } = await fetchPublicProvider(provider, collectParams(request), request.signal);
    return NextResponse.json(body, {
        status,
        headers: { 'cache-control': 'no-store' }
    });
}
