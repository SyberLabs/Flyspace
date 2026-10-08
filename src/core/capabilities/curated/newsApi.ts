// NewsAPI.org headlines and article search.
// Hand-written from https://newsapi.org/docs/endpoints/top-headlines and
// /everything (2026-10-07). The key goes in the X-Api-Key header, which keeps
// it out of the URL. NewsAPI sends no CORS headers (and its free plan refuses
// browser calls), so Flyspace reaches it through its server broker.

const ARTICLES = {
    type: 'object',
    properties: {
        status: { type: 'string' },
        totalResults: { type: 'integer' },
        articles: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    source: { type: 'object', properties: { id: { type: 'string', nullable: true }, name: { type: 'string' } } },
                    author: { type: 'string', nullable: true },
                    title: { type: 'string' },
                    description: { type: 'string', nullable: true },
                    url: { type: 'string' },
                    urlToImage: { type: 'string', nullable: true },
                    publishedAt: { type: 'string' },
                    content: { type: 'string', nullable: true }
                }
            }
        }
    }
};

const PAGE_SIZE = { name: 'pageSize', in: 'query', description: 'How many articles (1 to 100).', example: 20, schema: { type: 'integer' } };

export const NEWS_API_SPEC = {
    openapi: '3.0.3',
    info: {
        title: 'NewsAPI Headlines',
        version: '2.0.0',
        description: 'Breaking headlines by country or category, and search across articles from thousands of sources. Free key.'
    },
    servers: [{ url: 'https://newsapi.org/v2' }],
    security: [{ newsApiKey: [] }],
    components: {
        securitySchemes: {
            newsApiKey: {
                type: 'apiKey',
                in: 'header',
                name: 'X-Api-Key',
                description: 'Your NewsAPI key (free for development). Get one at https://newsapi.org/register'
            }
        }
    },
    paths: {
        '/top-headlines': {
            get: {
                operationId: 'topHeadlines',
                summary: 'Top headlines now',
                parameters: [
                    { name: 'country', in: 'query', description: 'Two-letter country code, e.g. us, gb, de. Leave empty when using sources.', example: 'us', schema: { type: 'string' } },
                    {
                        name: 'category', in: 'query', description: 'Only this category. Not with sources.',
                        schema: { type: 'string', enum: ['business', 'entertainment', 'general', 'health', 'science', 'sports', 'technology'] }
                    },
                    { name: 'q', in: 'query', description: 'Only headlines with these words.', schema: { type: 'string' } },
                    { name: 'sources', in: 'query', description: 'Comma-separated source ids, e.g. bbc-news. Not with country or category.', schema: { type: 'string' } },
                    PAGE_SIZE
                ],
                responses: { '200': { description: 'Headlines', content: { 'application/json': { schema: ARTICLES } } } }
            }
        },
        '/everything': {
            get: {
                operationId: 'everything',
                summary: 'Search news articles',
                parameters: [
                    { name: 'q', in: 'query', required: true, description: 'Words or phrases to find. Quote a phrase; + must appear, - must not.', example: 'interest rates', schema: { type: 'string' } },
                    { name: 'language', in: 'query', description: 'Two-letter language code, e.g. en.', example: 'en', schema: { type: 'string' } },
                    { name: 'from', in: 'query', description: 'Oldest article (ISO 8601 date or date-time).', schema: { type: 'string', format: 'date' } },
                    { name: 'to', in: 'query', description: 'Newest article (ISO 8601 date or date-time).', schema: { type: 'string', format: 'date' } },
                    { name: 'sortBy', in: 'query', description: 'Order of results.', schema: { type: 'string', enum: ['publishedAt', 'relevancy', 'popularity'], default: 'publishedAt' } },
                    PAGE_SIZE
                ],
                responses: { '200': { description: 'Articles', content: { 'application/json': { schema: ARTICLES } } } }
            }
        }
    }
};
