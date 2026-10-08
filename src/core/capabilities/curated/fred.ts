// FRED (Federal Reserve Economic Data), St. Louis Fed.
// Hand-written from https://fred.stlouisfed.org/docs/api/fred/ (2026-10-07):
// FRED publishes no OpenAPI document, and is not in the APIs.guru directory.
// Three reads; FRED has no writes. `file_type` is pinned to json because the
// API answers XML by default. FRED sends no CORS headers, so Flyspace reaches
// it through its own server broker (see curatedApis.ts).

const DATE = { type: 'string', format: 'date' };

const SERIES = {
    type: 'object',
    properties: {
        id: { type: 'string', description: 'The series id, e.g. GDP or UNRATE' },
        title: { type: 'string' },
        observation_start: DATE,
        observation_end: DATE,
        frequency: { type: 'string' },
        units: { type: 'string' },
        seasonal_adjustment: { type: 'string' },
        last_updated: { type: 'string' },
        popularity: { type: 'integer' },
        notes: { type: 'string' }
    }
};

const FILE_TYPE = {
    name: 'file_type',
    in: 'query',
    required: true,
    description: 'Response format. Flyspace reads JSON.',
    schema: { type: 'string', enum: ['json'] }
};

const SERIES_ID = {
    name: 'series_id',
    in: 'query',
    required: true,
    description: 'The FRED series id: GDP, UNRATE (unemployment rate), CPIAUCSL (consumer prices), FEDFUNDS (fed funds rate), DGS10 (10-year Treasury yield).',
    example: 'UNRATE',
    schema: { type: 'string' }
};

export const FRED_SPEC = {
    openapi: '3.0.3',
    info: {
        title: 'FRED Economic Data',
        version: '1.0.0',
        description: 'Economic time series from the Federal Reserve Bank of St. Louis: GDP, unemployment, inflation, interest rates, and over 800,000 more.'
    },
    servers: [{ url: 'https://api.stlouisfed.org/fred' }],
    security: [{ fredKey: [] }],
    components: {
        securitySchemes: {
            fredKey: {
                type: 'apiKey',
                in: 'query',
                name: 'api_key',
                description: 'Your FRED API key (free). Request one at https://fredaccount.stlouisfed.org/apikeys'
            }
        }
    },
    paths: {
        '/series/observations': {
            get: {
                operationId: 'getSeriesObservations',
                summary: 'Values of an economic series over time',
                parameters: [
                    SERIES_ID,
                    FILE_TYPE,
                    { name: 'observation_start', in: 'query', description: 'First date to include (YYYY-MM-DD).', schema: DATE },
                    { name: 'observation_end', in: 'query', description: 'Last date to include (YYYY-MM-DD).', schema: DATE },
                    { name: 'sort_order', in: 'query', description: 'desc puts the latest value first.', schema: { type: 'string', enum: ['asc', 'desc'], default: 'asc' } },
                    { name: 'limit', in: 'query', description: 'How many values at most (1 to 100,000).', example: 24, schema: { type: 'integer' } },
                    {
                        name: 'units', in: 'query',
                        description: 'lin: as published; chg: change; pch: percent change; pc1: percent change from a year ago; log: natural log.',
                        schema: { type: 'string', enum: ['lin', 'chg', 'ch1', 'pch', 'pc1', 'pca', 'cch', 'cca', 'log'], default: 'lin' }
                    },
                    {
                        name: 'frequency', in: 'query',
                        description: 'Aggregate to a lower frequency: d daily, w weekly, m monthly, q quarterly, sa semiannual, a annual.',
                        schema: { type: 'string', enum: ['d', 'w', 'bw', 'm', 'q', 'sa', 'a'] }
                    }
                ],
                responses: {
                    '200': {
                        description: 'The observations',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        units: { type: 'string' },
                                        count: { type: 'integer' },
                                        observations: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    date: DATE,
                                                    value: { type: 'string', description: 'The value as text; "." when missing' },
                                                    realtime_start: DATE,
                                                    realtime_end: DATE
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/series/search': {
            get: {
                operationId: 'searchSeries',
                summary: 'Find economic series by keyword',
                parameters: [
                    { name: 'search_text', in: 'query', required: true, description: 'Words to look for in series titles and notes.', example: 'unemployment rate', schema: { type: 'string' } },
                    FILE_TYPE,
                    { name: 'limit', in: 'query', description: 'How many series at most (1 to 1,000).', example: 10, schema: { type: 'integer' } },
                    {
                        name: 'order_by', in: 'query', description: 'popularity puts the most-used series first.',
                        schema: { type: 'string', enum: ['search_rank', 'popularity', 'title', 'last_updated'], default: 'search_rank' }
                    }
                ],
                responses: {
                    '200': {
                        description: 'Matching series',
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { count: { type: 'integer' }, seriess: { type: 'array', items: SERIES } } }
                            }
                        }
                    }
                }
            }
        },
        '/series': {
            get: {
                operationId: 'getSeries',
                summary: 'Describe one economic series',
                parameters: [SERIES_ID, FILE_TYPE],
                responses: {
                    '200': {
                        description: 'The series',
                        content: {
                            'application/json': {
                                schema: { type: 'object', properties: { seriess: { type: 'array', items: SERIES } } }
                            }
                        }
                    }
                }
            }
        }
    }
};
