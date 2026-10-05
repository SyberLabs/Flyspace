// POST /api/capability-broker
// Fetches one read or compute capability whose manifest asked for server_broker.
// The URL is rebuilt from the manifest. Egress policy runs before the socket opens.

import { lookup } from 'node:dns/promises';
import { NextRequest, NextResponse } from 'next/server';
import { admitBrokerCaller, BROKER_DEADLINE_MS, handleCapabilityBroker } from '@/core/services/server/capabilityBroker';
import { clientKey } from '@/core/services/server/clientKey';
import { openServerLedger } from '@/core/services/server/capability.ledger';
import { pinnedFetch } from '@/core/services/server/pinnedFetch';
import { readBoundedJson, RequestBodyTooLarge } from '@/core/services/server/boundedJson';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REQUEST_BYTES = 256 * 1024;

function reply(status: number, body: unknown) {
    return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
    if (process.env.OMNI_PUBLIC_DEMO === '1') {
        return reply(503, { error: 'The capability broker is unavailable in the public preview.' });
    }
    // Only this app's own pages may drive the broker. A cross-site form or
    // fetch cannot set an application/json content type without a preflight.
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) {
        return reply(403, { error: 'Request must come from this site.' });
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return reply(415, { error: 'Content-Type must be application/json.' });
    }

    // The caller and global budgets are checked before any body byte is read,
    // so an over-budget caller costs no read and no parse. Like the refusals
    // above, a 429 leaves the body unread for the server to discard.
    const caller = clientKey(request);
    const admission = admitBrokerCaller(caller);
    if (!admission) return reply(429, { error: 'broker rate limit exceeded' });

    // One deadline from route entry: body read, DNS, and the upstream call.
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(BROKER_DEADLINE_MS)]);
    let body: unknown;
    try {
        body = await readBoundedJson(request, signal, MAX_REQUEST_BYTES);
    } catch (error) {
        if (error instanceof RequestBodyTooLarge) return reply(413, { error: 'Request body exceeds 256 KiB' });
        if (signal.aborted) return new Response(null, { status: request.signal.aborted ? 499 : 504 });
        return reply(400, { error: 'Invalid JSON' });
    }
    const result = await handleCapabilityBroker(body, {
        ledger: openServerLedger(),
        resolve: async (hostname) => (await lookup(hostname, { all: true })).map(entry => entry.address),
        fetch: pinnedFetch,
        signal,
        caller,
        admission
    });
    return reply(result.status, result.body);
}
