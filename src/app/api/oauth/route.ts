// GET /api/oauth
// Which sign-in providers this server has an OAuth client for (connectProviders.ts).
// Names only. Empty in the public preview.

import { NextResponse } from 'next/server';
import { configuredProviders } from '@/core/services/server/oauthConnect';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
    return NextResponse.json({ providers: configuredProviders() }, { headers: { 'cache-control': 'no-store' } });
}
