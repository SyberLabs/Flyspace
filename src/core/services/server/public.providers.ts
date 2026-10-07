// ============================================
// KEYLESS PUBLIC PROXY
//
// Demo APIs that need no credential. The browser asks OmniOS; OmniOS asks
// the provider. That hop exists so CORS and User-Agent rules cannot empty
// a block that is sitting on the canvas.
//
// Never add a keyed provider here.
// ============================================

import 'server-only';
import { getApiProvider } from '@/core/schemas/api.schema';
import { readBoundedJson, RequestBodyTooLarge } from './boundedJson';

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

/**
 * One deadline for connect, headers and body. 8 s matches /api/jev-persona:
 * these are single small GETs and a canvas block is waiting on them, so the
 * broker's 15 s (which covers a whole capability run) would be too generous.
 */
export const PUBLIC_UPSTREAM_DEADLINE_MS = 8000;
/** Same cap the capability broker puts on an upstream body. */
export const PUBLIC_MAX_RESPONSE_BYTES = 1_000_000;

export type PublicFailureCode =
    | 'upstream_timeout'
    | 'upstream_redirect'
    | 'upstream_status'
    | 'upstream_too_large'
    | 'upstream_shape'
    | 'upstream_unreachable';

export interface PublicFailure {
    error: { code: PublicFailureCode; message: string };
}

type Outcome = { status: number; body: unknown };

function failure(id: string, code: PublicFailureCode, message: string, detail: Record<string, unknown> = {}): Outcome {
    // Status, code and keys only. The upstream body never reaches the log.
    console.warn('[public proxy] upstream failure', { provider: id, code, ...detail });
    const body: PublicFailure = { error: { code, message: `${id}: ${message}` } };
    return { status: 502, body };
}

function redirectHost(res: Response): string {
    try {
        return new URL(res.headers.get('location') || '').host || '(none)';
    } catch {
        return '(unparseable)';
    }
}

export async function fetchPublicProvider(
    id: string,
    params: Params,
    callerSignal?: AbortSignal
): Promise<Outcome> {
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

    const deadline = AbortSignal.timeout(PUBLIC_UPSTREAM_DEADLINE_MS);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;

    let res: Response;
    try {
        // 'manual': a relay that follows redirects can be pointed at whatever
        // the allowlisted host redirects to. A 3xx is reported, not followed.
        res = await fetch(url, { headers: headersFor(id), cache: 'no-store', redirect: 'manual', signal });
    } catch (error) {
        const name = error instanceof Error ? error.name : 'Unknown';
        if (name === 'TimeoutError' || name === 'AbortError') {
            return failure(id, 'upstream_timeout', `no response within ${PUBLIC_UPSTREAM_DEADLINE_MS / 1000} s`);
        }
        return failure(id, 'upstream_unreachable', 'request failed', { name });
    }

    if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        return failure(id, 'upstream_redirect', 'upstream redirected; redirects are not followed', {
            status: res.status,
            location: redirectHost(res)
        });
    }
    if (!res.ok) {
        return failure(id, 'upstream_status', `upstream returned ${res.status}`, { status: res.status });
    }

    try {
        const body = await readBoundedJson(res, signal, PUBLIC_MAX_RESPONSE_BYTES);
        return { status: 200, body };
    } catch (error) {
        if (error instanceof RequestBodyTooLarge) {
            return failure(id, 'upstream_too_large', `response exceeded ${PUBLIC_MAX_RESPONSE_BYTES} bytes`);
        }
        const name = error instanceof Error ? error.name : 'Unknown';
        if (name === 'TimeoutError' || name === 'AbortError') {
            return failure(id, 'upstream_timeout', `body not complete within ${PUBLIC_UPSTREAM_DEADLINE_MS / 1000} s`);
        }
        // SyntaxError (and only its name): the message would quote the body.
        return failure(id, 'upstream_shape', 'non-JSON response', { name });
    }
}
