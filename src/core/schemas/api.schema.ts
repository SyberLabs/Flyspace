// ============================================
// PROJECT OMNI: API PROVIDER SCHEMA
// The catalog the gateway, the public proxy and shells read
// ============================================

/**
 * OmniData gateway categories (used by the API gateway layer)
 */
export type GatewayCategory =
    | 'prediction_market'
    | 'news'
    | 'market_data'
    | 'transport'
    | 'weather'
    | 'llm'
    | 'social'
    | 'bio'
    | 'developer'
    | 'custom';

/**
 * REST list adapter config (generic JSON list APIs)
 */
export interface RestListAdapterConfig {
    /** Relative path appended to baseUrl */
    path: string;
    /** GET or POST (default GET) */
    method?: 'GET' | 'POST';
    /** Default query params */
    defaultParams?: Record<string, string | number | boolean>;
    /** Optional headers */
    headers?: Record<string, string>;
    /** Auth placement */
    auth?: {
        in: 'header' | 'query';
        name?: string;      // Header or query key
        prefix?: string;    // e.g., "Bearer "
    };
    /** Dot path to list of items in response */
    itemsPath?: string;
    /** Mapping from item fields to OmniItem */
    itemMap: {
        id?: string;
        title: string;
        description?: string;
        url?: string;
        image?: string;
        timestamp?: string;
        tags?: string;
    };
    /** Additional metadata field mapping */
    metadataMap?: Record<string, string>;
    /** Override cache TTL for this adapter */
    cacheTtlMs?: number;
    /** Override rate limit for this adapter */
    rateLimitMs?: number;
    /** OmniData category for this adapter */
    category?: GatewayCategory;
    /**
     * Fetch through /api/public instead of the browser hitting the
     * provider. Use this for any demo API whose CORS or User-Agent
     * rules would otherwise leave the block empty on the canvas.
     */
    via?: 'direct' | 'proxy';
    /** Query param the feed view treats as a search box, if present. */
    searchParam?: string;
}

/**
 * Gateway integration config
 */
export type ApiGatewayAdapter =
    | {
        type: 'normalizer';
        normalizerId: string;
        defaultParams?: Record<string, unknown>;
    }
    | {
        type: 'rest_list';
        config: RestListAdapterConfig;
    };

/**
 * API integration metadata
 */
export interface ApiIntegration {
    gateway?: ApiGatewayAdapter;
}

/**
 * API Provider definition
 */
export interface ApiProvider {
    /** Unique identifier */
    id: string;

    /** Display name */
    name: string;

    /** Base URL for the API */
    baseUrl: string;

    /** Whether API key is required */
    requiresAuth: boolean;

    /**
     * process.env name of the server-side key (proxied via /api/data; the
     * browser never holds it). Render the NAME, never the value.
     */
    envVar?: string;

    /** Corresponding block IDs that use this API */
    blockIds?: string[];

    /** Integration metadata */
    integration?: ApiIntegration;
}

// ============================================
// API CATALOG
// ============================================

export const API_CATALOG: ApiProvider[] = [
    // Only providers with a working gateway integration remain;
    // the listed-only placeholders were a catalog, not a product.
    {
        id: 'polymarket',
        name: 'Polymarket',
        baseUrl: 'https://gamma-api.polymarket.com',
        requiresAuth: false,
        blockIds: ['polymarket_live_odds'],
        integration: {
            gateway: {
                type: 'normalizer',
                normalizerId: 'polymarket',
                defaultParams: { limit: 50 }
            }
        }
    },
    {
        id: 'coingecko',
        name: 'CoinGecko',
        baseUrl: 'https://api.coingecko.com/api/v3',
        requiresAuth: false,
        blockIds: ['coingecko_crypto'],
        integration: {
            gateway: {
                type: 'normalizer',
                normalizerId: 'coingecko',
                defaultParams: { currency: 'usd', limit: 25 }
            }
        }
    },
    {
        id: 'hackernews',
        name: 'Hacker News',
        baseUrl: 'https://hacker-news.firebaseio.com/v0',
        requiresAuth: false,
        blockIds: ['hackernews_feed'],
        integration: {
            gateway: {
                type: 'normalizer',
                normalizerId: 'hackernews',
                defaultParams: { type: 'top', limit: 30 }
            }
        }
    },
    {
        id: 'openalex',
        name: 'OpenAlex',
        baseUrl: 'https://api.openalex.org',
        requiresAuth: false,
        blockIds: ['openalex_works'],
        integration: {
            gateway: {
                type: 'rest_list',
                config: {
                    path: '/works',
                    defaultParams: {
                        per_page: 25,
                        sort: 'publication_date:desc'
                    },
                    auth: {
                        in: 'query',
                        name: 'api_key'
                    },
                    itemsPath: 'results',
                    itemMap: {
                        id: 'id',
                        title: 'display_name',
                        description: 'host_venue.display_name',
                        url: 'primary_location.landing_page_url',
                        timestamp: 'publication_date',
                        tags: 'type'
                    },
                    metadataMap: {
                        citedBy: 'cited_by_count',
                        publicationYear: 'publication_year',
                        doi: 'doi'
                    },
                    cacheTtlMs: 10 * 60 * 1000,
                    rateLimitMs: 1000,
                    category: 'developer'
                }
            }
        }
    },
    {
        id: 'worldbank',
        name: 'World Bank',
        baseUrl: 'https://api.worldbank.org/v2',
        requiresAuth: false,
        blockIds: ['worldbank_indicator'],
        integration: {
            gateway: {
                type: 'normalizer',
                normalizerId: 'worldbank',
                defaultParams: {
                    country: 'USA',
                    indicator: 'NY.GDP.MKTP.CD',
                    per_page: 60
                }
            }
        }
    },
    {
        id: 'usgs',
        name: 'USGS Earthquakes',
        baseUrl: 'https://earthquake.usgs.gov',
        requiresAuth: false,
        blockIds: ['usgs_quakes'],
        integration: {
            gateway: {
                type: 'rest_list',
                config: {
                    path: '/earthquakes/feed/v1.0/summary/4.5_week.geojson',
                    via: 'proxy',
                    itemsPath: 'features',
                    itemMap: {
                        id: 'id',
                        title: 'properties.place',
                        description: 'properties.mag',
                        url: 'properties.url',
                        timestamp: 'properties.time'
                    },
                    metadataMap: {
                        magnitude: 'properties.mag',
                        tsunami: 'properties.tsunami',
                        alert: 'properties.alert'
                    },
                    cacheTtlMs: 5 * 60 * 1000,
                    rateLimitMs: 2000,
                    category: 'custom'
                }
            }
        }
    },
    {
        id: 'openmeteo',
        name: 'Open-Meteo',
        baseUrl: 'https://api.open-meteo.com',
        requiresAuth: false,
        blockIds: ['openmeteo_forecast'],
        integration: {
            gateway: {
                type: 'normalizer',
                normalizerId: 'openmeteo',
                defaultParams: { latitude: 40.71, longitude: -74.01 }
            }
        }
    },
    {
        id: 'frankfurter',
        name: 'Frankfurter FX',
        baseUrl: 'https://api.frankfurter.app',
        requiresAuth: false,
        blockIds: ['frankfurter_fx'],
        integration: {
            gateway: {
                type: 'normalizer',
                normalizerId: 'frankfurter',
                defaultParams: { from: 'USD' }
            }
        }
    },
    {
        id: 'wikipedia',
        name: 'Wikipedia',
        baseUrl: 'https://en.wikipedia.org',
        requiresAuth: false,
        blockIds: ['wikipedia_search'],
        integration: {
            gateway: {
                type: 'rest_list',
                config: {
                    path: '/w/api.php',
                    via: 'proxy',
                    searchParam: 'srsearch',
                    defaultParams: {
                        action: 'query',
                        list: 'search',
                        srsearch: 'artificial intelligence',
                        srlimit: 12,
                        format: 'json'
                    },
                    itemsPath: 'query.search',
                    itemMap: {
                        id: 'pageid',
                        title: 'title',
                        description: 'snippet'
                    },
                    metadataMap: {
                        wikiTitle: 'title',
                        wordcount: 'wordcount'
                    },
                    cacheTtlMs: 10 * 60 * 1000,
                    rateLimitMs: 1000,
                    category: 'news'
                }
            }
        }
    },
    {
        id: 'openlibrary',
        name: 'Open Library',
        baseUrl: 'https://openlibrary.org',
        requiresAuth: false,
        blockIds: ['openlibrary_search'],
        integration: {
            gateway: {
                type: 'rest_list',
                config: {
                    path: '/search.json',
                    via: 'proxy',
                    searchParam: 'q',
                    defaultParams: {
                        q: 'artificial intelligence',
                        limit: 12
                    },
                    itemsPath: 'docs',
                    itemMap: {
                        id: 'key',
                        title: 'title',
                        description: 'author_name.0'
                    },
                    metadataMap: {
                        workKey: 'key',
                        year: 'first_publish_year',
                        editionCount: 'edition_count'
                    },
                    cacheTtlMs: 10 * 60 * 1000,
                    rateLimitMs: 1000,
                    category: 'developer'
                }
            }
        }
    },
    {
        id: 'github',
        name: 'GitHub',
        baseUrl: 'https://api.github.com',
        requiresAuth: false,
        blockIds: ['github_repos'],
        integration: {
            gateway: {
                type: 'rest_list',
                config: {
                    path: '/search/repositories',
                    via: 'proxy',
                    searchParam: 'q',
                    defaultParams: {
                        q: 'stars:>10000',
                        sort: 'stars',
                        order: 'desc',
                        per_page: 12
                    },
                    headers: {
                        Accept: 'application/vnd.github+json'
                    },
                    itemsPath: 'items',
                    itemMap: {
                        id: 'id',
                        title: 'full_name',
                        description: 'description',
                        url: 'html_url',
                        timestamp: 'updated_at'
                    },
                    metadataMap: {
                        stars: 'stargazers_count',
                        language: 'language',
                        forks: 'forks_count'
                    },
                    cacheTtlMs: 10 * 60 * 1000,
                    rateLimitMs: 5000,
                    category: 'developer'
                }
            }
        }
    },
    {
        id: 'crossref',
        name: 'Crossref',
        baseUrl: 'https://api.crossref.org',
        requiresAuth: false,
        blockIds: ['crossref_works'],
        integration: {
            gateway: {
                type: 'rest_list',
                config: {
                    path: '/works',
                    via: 'proxy',
                    searchParam: 'query',
                    defaultParams: {
                        query: 'foundation models',
                        rows: 12
                    },
                    itemsPath: 'message.items',
                    itemMap: {
                        id: 'DOI',
                        title: 'title.0',
                        description: 'publisher',
                        url: 'URL'
                    },
                    metadataMap: {
                        doi: 'DOI',
                        type: 'type',
                        container: 'container-title.0'
                    },
                    cacheTtlMs: 10 * 60 * 1000,
                    rateLimitMs: 1000,
                    category: 'developer'
                }
            }
        }
    }
];

/**
 * Get provider by ID
 */
export function getApiProvider(providerId: string): ApiProvider | undefined {
    return API_CATALOG.find(api => api.id === providerId);
}

/**
 * Providers that work with nothing in .env. Safe to drop on a demo canvas.
 */
export function getKeylessApis(): ApiProvider[] {
    return API_CATALOG.filter(api => !api.requiresAuth);
}
