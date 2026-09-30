// ============================================
// PROJECT OMNI: API PROVIDER SCHEMA
// The catalog the gateway, the public proxy and shells read
// ============================================

/**
 * API categories aligned with Omni OS block types
 */
export type ApiCategory =
    | 'truth'        // Prediction markets, finance
    | 'pulse'        // News, narrative, sentiment
    | 'physicality'  // Location, tracking, movement
    | 'bio'          // Health, biometrics
    | 'ai'           // LLM providers, ML APIs
    | 'environment'  // Weather, satellite, climate
    | 'social'       // Social media, communication
    | 'developer'    // Productivity, dev tools
    | 'economy'      // Economic data, commerce
    | 'custom';      // User-defined

/**
 * Pricing model for API
 */
export type ApiPricing = 'free' | 'freemium' | 'paid' | 'open_source';

/**
 * Integration support level
 */
export type ApiSupportLevel = 'supported' | 'experimental' | 'planned';

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
 * Connection status for an API
 */
export type ApiStatus =
    | 'connected'      // Active and receiving data
    | 'idle'           // Configured but not in use
    | 'error'          // Connection failed
    | 'not_configured' // No API key set
    | 'testing';       // Currently testing connection

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
    support: ApiSupportLevel;
    gateway?: ApiGatewayAdapter;
    testParams?: Record<string, unknown>;
}

/**
 * API Provider definition
 */
export interface ApiProvider {
    /** Unique identifier */
    id: string;

    /** Display name */
    name: string;

    /** Category */
    category: ApiCategory;

    /** Short description */
    description: string;

    /** Icon (Lucide icon name) */
    icon: string;

    /** Base URL for the API */
    baseUrl: string;

    /** Documentation URL */
    docsUrl?: string;

    /** Pricing model */
    pricing: ApiPricing;

    /** Free tier limits (if applicable) */
    freeTierLimits?: string;

    /** Whether API key is required */
    requiresAuth: boolean;

    /**
     * The key is configured server-side (process.env) and proxied via
     * /api/data. The browser neither holds nor sends it, so the dashboard
     * must not prompt for one.
     */
    serverKeyed?: boolean;

    /**
     * process.env name when serverKeyed. Render the NAME, never the value.
     */
    envVar?: string;

    /** Corresponding block IDs that use this API */
    blockIds?: string[];

    /** Tags for search */
    tags: string[];

    /** Integration metadata */
    integration?: ApiIntegration;
}

/**
 * Stored per-provider configuration.
 */
export interface ApiConfig {
    providerId: string;
    status: ApiStatus;
    requestCount: number;
    lastRequest?: number;
    errorMessage?: string;
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
        category: 'truth',
        description: 'Prediction market odds and probabilities',
        icon: 'TrendingUp',
        baseUrl: 'https://gamma-api.polymarket.com',
        docsUrl: 'https://docs.polymarket.com',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['polymarket_live_odds'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'polymarket',
                defaultParams: { limit: 50 }
            },
            testParams: { limit: 10 }
        },
        tags: ['prediction', 'betting', 'markets', 'probability']
    },
    {
        id: 'metaculus',
        name: 'Metaculus',
        category: 'truth',
        description: 'Forecasting platform with calibrated predictions',
        icon: 'Target',
        baseUrl: 'https://www.metaculus.com/api',
        docsUrl: 'https://www.metaculus.com/api/',
        pricing: 'free',
        requiresAuth: true,
        serverKeyed: true,
        envVar: 'METACULUS_API_KEY',
        blockIds: ['metaculus_forecast'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'metaculus',
                defaultParams: { limit: 50 }
            },
            testParams: { limit: 10 }
        },
        tags: ['forecasting', 'prediction', 'calibration']
    },
    {
        id: 'alpha_vantage',
        name: 'Alpha Vantage',
        category: 'truth',
        description: 'Stock, forex, and crypto market data',
        icon: 'LineChart',
        baseUrl: 'https://www.alphavantage.co',
        docsUrl: 'https://www.alphavantage.co/documentation/',
        pricing: 'freemium',
        freeTierLimits: '25 requests/day',
        requiresAuth: true,
        serverKeyed: true,
        envVar: 'ALPHA_VANTAGE_API_KEY',
        blockIds: ['alpha_vantage_quote'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'alpha_vantage',
                defaultParams: { function: 'GLOBAL_QUOTE', symbol: 'IBM' }
            },
            testParams: { function: 'GLOBAL_QUOTE', symbol: 'IBM' }
        },
        tags: ['stocks', 'forex', 'crypto', 'finance']
    },
    {
        id: 'coingecko',
        name: 'CoinGecko',
        category: 'truth',
        description: 'Cryptocurrency prices and market data',
        icon: 'Coins',
        baseUrl: 'https://api.coingecko.com/api/v3',
        docsUrl: 'https://www.coingecko.com/en/api/documentation',
        pricing: 'freemium',
        freeTierLimits: '10-50 calls/min',
        requiresAuth: false,
        blockIds: ['coingecko_crypto'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'coingecko',
                defaultParams: { currency: 'usd', limit: 25 }
            },
            testParams: { currency: 'usd', limit: 10 }
        },
        tags: ['crypto', 'prices', 'market cap']
    },
    {
        id: 'fred',
        name: 'FRED',
        category: 'truth',
        description: 'Federal Reserve economic data',
        icon: 'Building',
        baseUrl: 'https://api.stlouisfed.org/fred',
        docsUrl: 'https://fred.stlouisfed.org/docs/api/',
        pricing: 'free',
        requiresAuth: true,
        serverKeyed: true,
        envVar: 'FRED_API_KEY',
        blockIds: ['fred_series'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'fred',
                defaultParams: {
                    seriesId: 'GDP',
                    limit: 24,
                    sort_order: 'desc'
                }
            },
            testParams: {
                seriesId: 'GDP',
                limit: 5,
                sort_order: 'desc'
            }
        },
        tags: ['economics', 'federal reserve', 'data']
    },
    {
        id: 'newsapi',
        name: 'NewsAPI',
        category: 'pulse',
        description: 'Aggregated news headlines worldwide',
        icon: 'Newspaper',
        baseUrl: 'https://newsapi.org/v2',
        docsUrl: 'https://newsapi.org/docs',
        pricing: 'freemium',
        freeTierLimits: '100 requests/day',
        requiresAuth: true,
        serverKeyed: true,
        envVar: 'NEWSAPI_KEY',
        blockIds: ['newsapi_feed'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'newsapi',
                defaultParams: { endpoint: 'top-headlines', country: 'us', pageSize: 20 }
            },
            testParams: { endpoint: 'top-headlines', country: 'us', pageSize: 5 }
        },
        tags: ['news', 'headlines', 'media']
    },
    {
        id: 'hackernews',
        name: 'Hacker News',
        category: 'pulse',
        description: 'Tech community feed',
        icon: 'Zap',
        baseUrl: 'https://hacker-news.firebaseio.com/v0',
        docsUrl: 'https://github.com/HackerNews/API',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['hackernews_feed'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'hackernews',
                defaultParams: { type: 'top', limit: 30 }
            },
            testParams: { type: 'top', limit: 10 }
        },
        tags: ['tech', 'startups', 'programming']
    },
    {
        id: 'openalex',
        name: 'OpenAlex',
        category: 'developer',
        description: 'Open scholarly graph of research works',
        icon: 'BookOpen',
        baseUrl: 'https://api.openalex.org',
        docsUrl: 'https://docs.openalex.org/',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['openalex_works'],
        integration: {
            support: 'supported',
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
            },
            testParams: {
                per_page: 5,
                sort: 'publication_date:desc'
            }
        },
        tags: ['research', 'papers', 'citations', 'scholarly']
    },
    {
        id: 'worldbank',
        name: 'World Bank',
        category: 'economy',
        description: 'Global economic indicators',
        icon: 'Globe',
        baseUrl: 'https://api.worldbank.org/v2',
        docsUrl: 'https://datahelpdesk.worldbank.org/knowledgebase/topics/125589',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['worldbank_indicator'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'worldbank',
                defaultParams: {
                    country: 'USA',
                    indicator: 'NY.GDP.MKTP.CD',
                    per_page: 60
                }
            },
            testParams: {
                country: 'USA',
                indicator: 'SP.POP.TOTL',
                per_page: 5
            }
        },
        tags: ['economics', 'global', 'data']
    },
    {
        id: 'usgs',
        name: 'USGS Earthquakes',
        category: 'physicality',
        description: 'Magnitude 4.5+ earthquakes in the last week',
        icon: 'Activity',
        baseUrl: 'https://earthquake.usgs.gov',
        docsUrl: 'https://earthquake.usgs.gov/fdsnws/event/1/',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['usgs_quakes'],
        integration: {
            support: 'supported',
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
        },
        tags: ['earthquake', 'geology', 'hazards']
    },
    {
        id: 'openmeteo',
        name: 'Open-Meteo',
        category: 'environment',
        description: 'Current conditions and daily forecast, no API key',
        icon: 'CloudSun',
        baseUrl: 'https://api.open-meteo.com',
        docsUrl: 'https://open-meteo.com/en/docs',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['openmeteo_forecast'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'openmeteo',
                defaultParams: { latitude: 40.71, longitude: -74.01 }
            },
            testParams: { latitude: 40.71, longitude: -74.01 }
        },
        tags: ['weather', 'forecast', 'climate']
    },
    {
        id: 'frankfurter',
        name: 'Frankfurter FX',
        category: 'economy',
        description: 'ECB foreign-exchange reference rates',
        icon: 'DollarSign',
        baseUrl: 'https://api.frankfurter.app',
        docsUrl: 'https://www.frankfurter.app/docs/',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['frankfurter_fx'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'frankfurter',
                defaultParams: { from: 'USD' }
            },
            testParams: { from: 'USD' }
        },
        tags: ['fx', 'currency', 'ecb', 'rates']
    },
    {
        id: 'wikipedia',
        name: 'Wikipedia',
        category: 'pulse',
        description: 'Live article search across Wikipedia',
        icon: 'BookOpen',
        baseUrl: 'https://en.wikipedia.org',
        docsUrl: 'https://www.mediawiki.org/wiki/API:Main_page',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['wikipedia_search'],
        integration: {
            support: 'supported',
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
        },
        tags: ['encyclopedia', 'knowledge', 'search']
    },
    {
        id: 'openlibrary',
        name: 'Open Library',
        category: 'developer',
        description: 'Books and editions from the Internet Archive',
        icon: 'Library',
        baseUrl: 'https://openlibrary.org',
        docsUrl: 'https://openlibrary.org/developers/api',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['openlibrary_search'],
        integration: {
            support: 'supported',
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
        },
        tags: ['books', 'library', 'research']
    },
    {
        id: 'github',
        name: 'GitHub',
        category: 'developer',
        description: 'Public repositories by stars — no login',
        icon: 'Github',
        baseUrl: 'https://api.github.com',
        docsUrl: 'https://docs.github.com/en/rest',
        pricing: 'free',
        freeTierLimits: '60 unauthenticated requests/hour',
        requiresAuth: false,
        blockIds: ['github_repos'],
        integration: {
            support: 'supported',
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
        },
        tags: ['code', 'opensource', 'repos']
    },
    {
        id: 'crossref',
        name: 'Crossref',
        category: 'developer',
        description: 'Scholarly works by DOI — no API key',
        icon: 'Files',
        baseUrl: 'https://api.crossref.org',
        docsUrl: 'https://www.crossref.org/documentation/retrieve-metadata/rest-api/',
        pricing: 'free',
        requiresAuth: false,
        blockIds: ['crossref_works'],
        integration: {
            support: 'supported',
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
        },
        tags: ['research', 'doi', 'papers', 'citations']
    },
    {
        id: 'bls',
        name: 'BLS',
        category: 'economy',
        description: 'US labor statistics',
        icon: 'Users',
        baseUrl: 'https://api.bls.gov/publicAPI/v2',
        docsUrl: 'https://www.bls.gov/developers/',
        pricing: 'free',
        requiresAuth: true,
        serverKeyed: true,
        envVar: 'BLS_API_KEY',
        blockIds: ['bls_series'],
        integration: {
            support: 'supported',
            gateway: {
                type: 'normalizer',
                normalizerId: 'bls',
                defaultParams: {
                    seriesId: 'LNS14000000'
                }
            },
            testParams: {
                seriesId: 'LNS14000000'
            }
        },
        tags: ['employment', 'labor', 'statistics']
    }
];

/**
 * Get API providers by category
 */
export function getApisByCategory(category: ApiCategory): ApiProvider[] {
    return API_CATALOG.filter(api => api.category === category);
}

/**
 * Search APIs by query
 */
export function searchApis(query: string): ApiProvider[] {
    const lowerQuery = query.toLowerCase();
    return API_CATALOG.filter(api =>
        api.name.toLowerCase().includes(lowerQuery) ||
        api.description.toLowerCase().includes(lowerQuery) ||
        api.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
}

/**
 * Get provider by ID
 */
export function getApiProvider(providerId: string): ApiProvider | undefined {
    return API_CATALOG.find(api => api.id === providerId);
}

/**
 * Get integration support level for a provider
 */
export function getApiSupportLevel(providerId: string): ApiSupportLevel {
    const provider = getApiProvider(providerId);
    return provider?.integration?.support || 'planned';
}

/**
 * Whether an API is supported by the gateway
 */
export function isApiSupported(providerId: string): boolean {
    const support = getApiSupportLevel(providerId);
    return support === 'supported' || support === 'experimental';
}

/**
 * Get all providers that are supported by the gateway
 */
export function getSupportedApis(): ApiProvider[] {
    return API_CATALOG.filter(api => isApiSupported(api.id));
}

/**
 * Supported providers that work with nothing in .env.
 * Pre-installed in the Command Center and safe to drop on a demo canvas.
 */
export function getKeylessApis(): ApiProvider[] {
    return getSupportedApis().filter(api => !api.requiresAuth);
}
