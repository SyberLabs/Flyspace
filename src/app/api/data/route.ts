// ============================================
// PROJECT OMNI: KEYED DATA PROXY
// GET /api/data?provider=<id>&...params
//
// One route for every provider that needs a key. The key is read from
// process.env server-side; the browser never holds it and never sends it.
// The upstream body is returned verbatim so client normalizers are unchanged.
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
    fetchKeyedProvider,
    isKeyedProvider,
    KEYED_PROVIDERS
} from '@/core/services/server/data.providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything except `provider` is passed through to the upstream builder. */
function collectParams(request: NextRequest): Record<string, string | undefined> {
    const params: Record<string, string | undefined> = {};
    request.nextUrl.searchParams.forEach((value, key) => {
        if (key !== 'provider') params[key] = value;
    });
    return params;
}

export async function GET(request: NextRequest) {
    if (process.env.OMNI_PUBLIC_DEMO === '1') {
        return NextResponse.json({ error: 'Keyed data is unavailable in the public preview.' }, { status: 503 });
    }

    const provider = request.nextUrl.searchParams.get('provider') || '';

    if (!isKeyedProvider(provider)) {
        return NextResponse.json(
            {
                error: `Unknown or unproxied provider: ${provider || '(missing)'}`,
                supported: KEYED_PROVIDERS
            },
            { status: 400 }
        );
    }

    const { status, body } = await fetchKeyedProvider(provider, collectParams(request));
    return NextResponse.json(body, {
        status,
        headers: { 'cache-control': 'no-store' }
    });
}
