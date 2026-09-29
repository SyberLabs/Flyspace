// POST /api/capability-broker
// Fetches one read or compute capability whose manifest asked for server_broker.
// The URL is rebuilt from the manifest. Egress policy runs before the socket opens.

import { lookup } from 'node:dns/promises';
import { NextRequest, NextResponse } from 'next/server';
import { handleCapabilityBroker } from '@/core/services/server/capabilityBroker';
import { openServerLedger } from '@/core/services/server/capability.ledger';
import { pinnedFetch } from '@/core/services/server/pinnedFetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    if (process.env.OMNI_PUBLIC_DEMO === '1') {
        return NextResponse.json({ error: 'The capability broker is unavailable in the public preview.' }, { status: 503 });
    }
    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const result = await handleCapabilityBroker(body, {
        ledger: openServerLedger(),
        resolve: async (hostname) => (await lookup(hostname, { all: true })).map(entry => entry.address),
        fetch: pinnedFetch
    });
    return NextResponse.json(result.body, {
        status: result.status,
        headers: { 'cache-control': 'no-store' }
    });
}
