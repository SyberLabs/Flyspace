// Ephemeral OpenAI Realtime transcription secret for one Hold to Talk capture.
// GET reports whether remote transcription is configured; POST mints the secret.

import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/core/services/server/auth';
import { mintRealtimeTranscriptionSecret, realtimeSpeechConfigured } from '@/core/services/server/realtimeSpeech';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 512;

function json(status: number, body: Record<string, unknown>): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
}

export async function GET(request: NextRequest) {
    const auth = await authenticateApiRequest(request);
    if (auth.response) return auth.response;
    return json(200, { configured: process.env.OMNI_PUBLIC_DEMO !== '1' && realtimeSpeechConfigured() });
}

export async function POST(request: NextRequest) {
    if (process.env.OMNI_PUBLIC_DEMO === '1' || !realtimeSpeechConfigured()) {
        return json(503, { error: 'unconfigured' });
    }
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) {
        return json(403, { error: 'Request must come from this site.' });
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return json(415, { error: 'Content-Type must be application/json.' });
    }
    const auth = await authenticateApiRequest(request);
    if (auth.response) return auth.response;

    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
        return json(400, { error: 'Request body is too large.' });
    }
    let locale: unknown;
    try {
        const text = await request.text();
        if (text.length > MAX_BODY_BYTES) return json(400, { error: 'Request body is too large.' });
        const body: unknown = text ? JSON.parse(text) : {};
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Invalid JSON' });
        locale = (body as Record<string, unknown>).locale;
    } catch {
        return json(400, { error: 'Invalid JSON' });
    }

    const minted = await mintRealtimeTranscriptionSecret({ locale, signal: request.signal });
    if (!minted.ok) return json(minted.status, { error: minted.error });
    return json(200, {
        clientSecret: minted.clientSecret,
        model: minted.model,
        ...(minted.expiresAt !== undefined ? { expiresAt: minted.expiresAt } : {})
    });
}
