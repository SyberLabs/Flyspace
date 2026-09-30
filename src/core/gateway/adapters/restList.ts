// ============================================
// PROJECT OMNI: GENERIC REST LIST ADAPTER
// Config-driven connector for JSON list APIs
// ============================================

import {
    ApiProvider,
    RestListAdapterConfig
} from '@/core/schemas/api.schema';
import {
    ApiTypeDefinition,
    OmniItem,
    createOmniData,
    createOmniError
} from '../omnidata.schema';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getValueByPath(obj: unknown, path?: string): unknown {
    if (!path) return undefined;
    const segments = path.split('.');
    let current: unknown = obj;
    for (const segment of segments) {
        if (isRecord(current) && segment in current) {
            current = current[segment];
            continue;
        }
        if (Array.isArray(current)) {
            const index = Number(segment);
            if (Number.isInteger(index) && index >= 0 && index < current.length) {
                current = current[index];
                continue;
            }
        }
        return undefined;
    }
    return current;
}

function toTimestamp(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}

function toTags(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        return value.map(v => String(v)).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value ? [value] : undefined;
    }
    return undefined;
}

function buildItems(raw: unknown, config: RestListAdapterConfig, providerId: string): OmniItem[] {
    const listSource = config.itemsPath ? getValueByPath(raw, config.itemsPath) : raw;
    const itemsArray = Array.isArray(listSource)
        ? listSource
        : isRecord(listSource) && Array.isArray(listSource.items)
            ? listSource.items
            : [];

    return itemsArray.map((item: unknown, index: number) => {
        const idValue = getValueByPath(item, config.itemMap.id);
        const titleValue = getValueByPath(item, config.itemMap.title);
        const descriptionValue = getValueByPath(item, config.itemMap.description);
        const urlValue = getValueByPath(item, config.itemMap.url);
        const imageValue = getValueByPath(item, config.itemMap.image);
        const timestampValue = getValueByPath(item, config.itemMap.timestamp);
        const tagsValue = getValueByPath(item, config.itemMap.tags);

        const metadata: Record<string, unknown> = {};
        if (config.metadataMap) {
            Object.entries(config.metadataMap).forEach(([key, path]) => {
                metadata[key] = getValueByPath(item, path);
            });
        }

        return {
            id: String(idValue ?? `${providerId}-${Date.now()}-${index}`),
            title: String(titleValue ?? 'Untitled'),
            description: descriptionValue != null ? String(descriptionValue) : undefined,
            url: urlValue != null ? String(urlValue) : undefined,
            image: imageValue != null ? String(imageValue) : undefined,
            timestamp: toTimestamp(timestampValue),
            tags: toTags(tagsValue),
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined
        };
    });
}

export function createRestListAdapter(
    provider: ApiProvider,
    config: RestListAdapterConfig
): ApiTypeDefinition<unknown> {
    return {
        category: config.category || 'custom',
        displayName: provider.name,
        cacheTtlMs: config.cacheTtlMs ?? 5 * 60 * 1000,
        rateLimitMs: config.rateLimitMs ?? 1000,

        fetchFn: async (_apiKey, params) => {
            const url = new URL(config.path, provider.baseUrl);
            const mergedParams: Record<string, string | number | boolean> = {
                ...(config.defaultParams || {})
            };
            Object.entries(params || {}).forEach(([key, value]) => {
                if (value !== undefined && value !== null) {
                    mergedParams[key] = value as string | number | boolean;
                }
            });

            Object.entries(mergedParams).forEach(([key, value]) => {
                url.searchParams.set(key, String(value));
            });

            if (config.via === 'proxy') {
                const query = new URLSearchParams({ provider: provider.id });
                Object.entries(mergedParams).forEach(([key, value]) => {
                    query.set(key, String(value));
                });
                try {
                    const response = await fetch(`/api/public?${query.toString()}`);
                    return await response.json();
                } catch (error) {
                    return {
                        error: {
                            code: 'FETCH_ERROR',
                            message: error instanceof Error ? error.message : 'Unknown error'
                        }
                    };
                }
            }

            const headers: Record<string, string> = {
                ...(config.headers || {})
            };

            try {
                const response = await fetch(url.toString(), {
                    method: config.method || 'GET',
                    headers
                });

                const data = await response.json();
                return data;
            } catch (error) {
                return {
                    error: {
                        code: 'FETCH_ERROR',
                        message: error instanceof Error ? error.message : 'Unknown error'
                    }
                };
            }
        },

        normalizeFn: (raw) => {
            if (isRecord(raw) && raw.error) {
                const err = isRecord(raw.error) ? raw.error : {};
                return createOmniError(provider.id, config.category || 'custom', {
                    code: typeof err.code === 'string' ? err.code : 'API_ERROR',
                    message: typeof err.message === 'string' ? err.message : 'Unknown error',
                    retryable: true
                });
            }

            const items = buildItems(raw, config, provider.id);
            return createOmniData(provider.id, config.category || 'custom', { items }, config.cacheTtlMs);
        }
    };
}
