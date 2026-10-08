// BLS (U.S. Bureau of Labor Statistics) Public Data API v2.
// Hand-written from https://www.bls.gov/developers/api_signature_v2.htm
// (2026-10-07), single-series GET form. Keyless: without a registration key
// BLS answers with its lower limits (checked 2026-10-07: a plain GET for
// LNS14000000 returned REQUEST_SUCCEEDED). BLS sends
// Access-Control-Allow-Origin: *, so the browser calls it directly.

const YEAR = { type: 'string', pattern: '^[0-9]{4}$' };

export const BLS_SPEC = {
    openapi: '3.0.3',
    info: {
        title: 'BLS Labor Statistics',
        version: '2.0.0',
        description: 'U.S. Bureau of Labor Statistics time series: unemployment, payrolls, consumer prices, wages. No key needed for light use.'
    },
    servers: [{ url: 'https://api.bls.gov/publicAPI/v2' }],
    paths: {
        '/timeseries/data/{seriesID}': {
            get: {
                operationId: 'getSeries',
                summary: 'Values of a labor statistics series',
                parameters: [
                    {
                        name: 'seriesID',
                        in: 'path',
                        required: true,
                        description: 'The BLS series id: LNS14000000 (unemployment rate), CES0000000001 (nonfarm payrolls), CUUR0000SA0 (consumer prices, all items).',
                        example: 'LNS14000000',
                        schema: { type: 'string' }
                    },
                    { name: 'startyear', in: 'query', description: 'First year to include (YYYY). Without a key, at most 10 years.', example: '2023', schema: YEAR },
                    { name: 'endyear', in: 'query', description: 'Last year to include (YYYY).', example: '2026', schema: YEAR }
                ],
                responses: {
                    '200': {
                        description: 'The series',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', description: 'REQUEST_SUCCEEDED, or why not' },
                                        message: { type: 'array', items: { type: 'string' } },
                                        Results: {
                                            type: 'object',
                                            properties: {
                                                series: {
                                                    type: 'array',
                                                    items: {
                                                        type: 'object',
                                                        properties: {
                                                            seriesID: { type: 'string' },
                                                            data: {
                                                                type: 'array',
                                                                items: {
                                                                    type: 'object',
                                                                    properties: {
                                                                        year: { type: 'string' },
                                                                        period: { type: 'string' },
                                                                        periodName: { type: 'string' },
                                                                        value: { type: 'string' },
                                                                        latest: { type: 'string' }
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
                            }
                        }
                    }
                }
            }
        }
    }
};
