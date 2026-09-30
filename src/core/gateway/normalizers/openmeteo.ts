// ============================================
// OPEN-METEO — current conditions + daily forecast
// Public API, fetched via /api/public so the canvas hop is CORS-proof.
// ============================================

import {
    ApiTypeDefinition,
    OmniItem,
    createOmniData,
    createOmniError
} from '../omnidata.schema';

interface OpenMeteoResponse {
    latitude?: number;
    longitude?: number;
    timezone?: string;
    current?: {
        time?: string;
        temperature_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        relative_humidity_2m?: number;
    };
    daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        precipitation_sum?: number[];
    };
    error?: boolean | { message?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const openmeteoNormalizer: ApiTypeDefinition<OpenMeteoResponse> = {
    category: 'weather',
    displayName: 'Open-Meteo',
    cacheTtlMs: 15 * 60 * 1000,
    rateLimitMs: 2000,

    fetchFn: async (_apiKey, params) => {
        const query = new URLSearchParams({ provider: 'openmeteo' });
        if (params?.latitude != null) query.set('latitude', String(params.latitude));
        if (params?.longitude != null) query.set('longitude', String(params.longitude));
        if (params?.timezone != null) query.set('timezone', String(params.timezone));
        try {
            const response = await fetch(`/api/public?${query.toString()}`);
            return await response.json() as OpenMeteoResponse;
        } catch (error) {
            return { error: { message: error instanceof Error ? error.message : 'Unknown error' } };
        }
    },

    normalizeFn: (raw) => {
        if (raw.error) {
            const message = isRecord(raw.error) && typeof raw.error.message === 'string'
                ? raw.error.message
                : 'Open-Meteo request failed';
            return createOmniError('openmeteo', 'weather', {
                code: 'API_ERROR',
                message,
                retryable: true
            });
        }

        const items: OmniItem[] = [];
        const current = raw.current;
        if (current) {
            items.push({
                id: 'current',
                title: `Now ${current.temperature_2m ?? '—'}°C`,
                description: `Wind ${current.wind_speed_10m ?? '—'} km/h · Humidity ${current.relative_humidity_2m ?? '—'}%`,
                timestamp: current.time ? Date.parse(current.time) : Date.now(),
                tags: ['current', raw.timezone].filter((t): t is string => Boolean(t)),
                metadata: {
                    temperature: current.temperature_2m,
                    wind: current.wind_speed_10m,
                    humidity: current.relative_humidity_2m,
                    weatherCode: current.weather_code,
                    latitude: raw.latitude,
                    longitude: raw.longitude
                }
            });
        }

        const days = raw.daily?.time ?? [];
        days.forEach((date, index) => {
            const max = raw.daily?.temperature_2m_max?.[index];
            const min = raw.daily?.temperature_2m_min?.[index];
            const rain = raw.daily?.precipitation_sum?.[index];
            items.push({
                id: date,
                title: date,
                description: `High ${max ?? '—'}°C / Low ${min ?? '—'}°C · Rain ${rain ?? '—'} mm`,
                timestamp: Date.parse(date),
                tags: ['daily'],
                metadata: { max, min, precipitation: rain }
            });
        });

        return createOmniData('openmeteo', 'weather', { items }, 15 * 60 * 1000);
    }
};
