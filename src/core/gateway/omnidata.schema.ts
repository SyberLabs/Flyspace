// ============================================
// PROJECT OMNI: OMNI DATA SCHEMA
// Unified output format for all API responses
// ============================================

/**
 * API categories for type discrimination
 */
type ApiCategory =
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
 * Source metadata for any OmniData
 */
interface OmniSource {
    /** API provider ID (e.g., 'polymarket', 'newsapi') */
    apiId: string;

    /** Category of the API */
    category: ApiCategory;

    /** When this data was fetched */
    fetchedAt: number;

    /** When this data expires (for caching) */
    expiresAt: number;

    /** Whether data is from cache */
    fromCache?: boolean;
}

/**
 * Generic item in a list (news articles, market predictions, etc.)
 */
export interface OmniItem {
    /** Unique identifier */
    id: string;

    /** Primary title/label */
    title: string;

    /** Optional description or summary */
    description?: string;

    /** URL to source */
    url?: string;

    /** Image URL */
    image?: string;

    /** Timestamp (milliseconds) */
    timestamp?: number;

    /** Categorization tags */
    tags?: string[];

    /** Type-specific properties */
    metadata?: Record<string, unknown>;
}

/**
 * Numeric metrics (prices, stats, counts)
 */
export interface OmniMetrics {
    /** Named metric values */
    values: Record<string, number>;

    /** Change indicators */
    changes?: Record<string, {
        value: number;
        direction: 'up' | 'down' | 'stable';
        period: string;
    }>;

    /** Timestamp of metrics */
    timestamp: number;
}

/**
 * Text/media content (LLM responses, documents)
 */
interface OmniContent {
    /** Text content */
    text: string;

    /** Content type */
    type: 'text' | 'markdown' | 'html' | 'code';

    /** Language (for code) */
    language?: string;

    /** Token usage (for LLM) */
    tokens?: {
        input: number;
        output: number;
    };

    /** Role (for chat) */
    role?: 'user' | 'assistant' | 'system';
}

/**
 * Unified data output from any API
 * All normalizers convert their responses to this shape
 */
export interface OmniData {
    /** Source information */
    source: OmniSource;

    /** List of items (news, predictions, flights, etc.) */
    items?: OmniItem[];

    /** Numeric metrics */
    metrics?: OmniMetrics;

    /** Text/content responses */
    content?: OmniContent;

    /** Error information if fetch failed */
    error?: {
        code: string;
        message: string;
        retryable: boolean;
    };

    /** Raw response for debugging */
    _raw?: unknown;
}

/**
 * API type definition for the gateway
 */
export interface ApiTypeDefinition<TRaw = unknown> {
    /** API category */
    category: ApiCategory;

    /** Human-readable name */
    displayName: string;

    /** Default cache TTL in milliseconds */
    cacheTtlMs: number;

    /** Minimum time between requests in milliseconds */
    rateLimitMs: number;

    /** Function to fetch raw data */
    fetchFn: (apiKey: string, params?: Record<string, unknown>) => Promise<TRaw>;

    /** Function to normalize raw data to OmniData */
    normalizeFn: (raw: TRaw) => OmniData;
}

/**
 * Gateway subscription callback
 */
export type OmniDataCallback = (data: OmniData) => void;

/**
 * Subscription entry
 */
export interface GatewaySubscription {
    apiId: string;
    blockId: string;
    callback: OmniDataCallback;
}

/**
 * Create a successful OmniData response
 */
export function createOmniData(
    apiId: string,
    category: ApiCategory,
    data: Partial<Pick<OmniData, 'items' | 'metrics' | 'content'>>,
    cacheTtlMs: number = 60000
): OmniData {
    const now = Date.now();
    return {
        source: {
            apiId,
            category,
            fetchedAt: now,
            expiresAt: now + cacheTtlMs
        },
        ...data
    };
}

/**
 * Create an error OmniData response
 */
export function createOmniError(
    apiId: string,
    category: ApiCategory,
    error: { code: string; message: string; retryable?: boolean }
): OmniData {
    const now = Date.now();
    return {
        source: {
            apiId,
            category,
            fetchedAt: now,
            expiresAt: now  // Don't cache errors
        },
        error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable ?? false
        }
    };
}
