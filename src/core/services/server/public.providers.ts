// ============================================
// KEYLESS PUBLIC PROXY
//
// Demo APIs that need no credential. The browser asks OmniOS; OmniOS asks
// the provider. That hop exists so CORS and User-Agent rules cannot empty
// a block that is sitting on the canvas.
//
// Never add a keyed provider here. Those stay on /api/data.
// ============================================

import 'server-only';
import { getApiProvider } from '@/core/schemas/api.schema';

export const PUBLIC_PROXY_IDS = [
    'usgs',
    'wikipedia',
    'openlibrary',
    'github',
    'crossref',
    'openmeteo',
    'frankfurter'
] as const;

export type PublicProviderId = (typeof PUBLIC_PROXY_IDS)[number];

export function isPublicProvider(id: string): id is PublicProviderId {
    return (PUBLIC_PROXY_IDS as readonly string[]).includes(id);
}

const USER_AGENT = 'OmniOS-demo/1.0 (https://github.com/SyberLabs/OmniOS)';

type Params = Record<string, string | undefined>;

function str(params: Params, key: string, fallback: string): string {
    const value = params[key];
    return value !== undefined && value !== '' ? value : fallback;
}

function buildCustomUrl(id: PublicProviderId, params: Params): string | null {
    if (id === 'openmeteo') {
        const url = new URL('https://api.open-meteo.com/v1/forecast');
        url.searchParams.set('latitude', str(params, 'latitude', '40.71'));
        url.searchParams.set('longitude', str(params, 'longitude', '-74.01'));
        url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m');
        url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum');
        url.searchParams.set('timezone', str(params, 'timezone', 'auto'));
        return url.toString();
    }
    if (id === 'frankfurter') {
        const url = new URL('https://api.frankfurter.app/latest');
        url.searchParams.set('from', str(params, 'from', 'USD'));
        return url.toString();
    }
    return null;
}

function buildRestListUrl(id: PublicProviderId, params: Params): string | null {
    const provider = getApiProvider(id);
    const gateway = provider?.integration?.gateway;
    if (!provider || gateway?.type !== 'rest_list') return null;

    const url = new URL(gateway.config.path, provider.baseUrl);
    const merged: Record<string, string | number | boolean> = {
        ...(gateway.config.defaultParams || {})
    };
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') merged[key] = value;
    });
    Object.entries(merged).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
    });
    return url.toString();
}

function headersFor(id: PublicProviderId): Record<string, string> {
    const provider = getApiProvider(id);
    const gateway = provider?.integration?.gateway;
    const extra = gateway?.type === 'rest_list' ? gateway.config.headers || {} : {};
    return {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...extra
    };
}

export async function fetchPublicProvider(
    id: string,
    params: Params
): Promise<{ status: number; body: unknown }> {
    if (!isPublicProvider(id)) {
        return {
            status: 400,
            body: { error: `Unknown or keyed provider: ${id || '(missing)'}`, supported: PUBLIC_PROXY_IDS }
        };
    }

    const url = buildCustomUrl(id, params) ?? buildRestListUrl(id, params);
    if (!url) {
        return { status: 400, body: { error: `No public builder for ${id}` } };
    }

    try {
        const res = await fetch(url, { headers: headersFor(id), cache: 'no-store', redirect: 'follow' });
        const body = await res.json().catch(() => null);
        if (body === null) {
            return { status: 502, body: { error: `${id} returned a non-JSON response` } };
        }
        return { status: 200, body };
    } catch {
        return { status: 502, body: { error: `${id} request failed` } };
    }
}
