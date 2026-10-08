// Alpha Vantage stock market data.
// Hand-written from https://www.alphavantage.co/documentation/ (2026-10-07),
// response shapes checked against the documented `demo` key. Every function
// is one GET /query, told apart by `function`, so it is one operation here
// with `function` as a choice: only functions that take a `symbol`, so the
// one field they need is required and in view (SYMBOL_SEARCH, which takes
// `keywords` instead, is left out for that reason). Alpha Vantage sends
// Access-Control-Allow-Origin: *, so the browser calls it directly. It
// reports a bad key or a rate limit as a 200 with "Error Message",
// "Information" or "Note"; those show as fields of the result.

export const ALPHA_VANTAGE_SPEC = {
    openapi: '3.0.3',
    info: {
        title: 'Alpha Vantage Stocks',
        version: '1.0.0',
        description: 'Stock quotes and daily or monthly price history. Free key.'
    },
    servers: [{ url: 'https://www.alphavantage.co' }],
    security: [{ alphaVantageKey: [] }],
    components: {
        securitySchemes: {
            alphaVantageKey: {
                type: 'apiKey',
                in: 'query',
                name: 'apikey',
                description: 'Your Alpha Vantage API key (free). Claim one at https://www.alphavantage.co/support/#api-key'
            }
        }
    },
    paths: {
        '/query': {
            get: {
                operationId: 'query',
                summary: 'Stock quote or price history',
                parameters: [
                    {
                        name: 'function',
                        in: 'query',
                        required: true,
                        description: 'GLOBAL_QUOTE: the latest price. TIME_SERIES_DAILY / TIME_SERIES_MONTHLY: price history.',
                        schema: { type: 'string', enum: ['GLOBAL_QUOTE', 'TIME_SERIES_DAILY', 'TIME_SERIES_MONTHLY'] }
                    },
                    { name: 'symbol', in: 'query', required: true, description: 'Ticker, e.g. IBM, AAPL, TSCO.LON.', example: 'IBM', schema: { type: 'string' } },
                    { name: 'outputsize', in: 'query', description: 'compact: the latest 100 points. full: everything (premium for some series).', schema: { type: 'string', enum: ['compact', 'full'], default: 'compact' } }
                ],
                responses: {
                    '200': {
                        description: 'The data, or an "Error Message", "Information" or "Note" field',
                        content: { 'application/json': { schema: { type: 'object' } } }
                    }
                }
            }
        }
    }
};
