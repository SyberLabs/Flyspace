// Metaculus forecasting questions.
// Metaculus serves its API docs and schema only to signed-in users, so this
// is written from the integration OmniOS ran before #60 (GET /api/posts/
// with limit and search; `Authorization: Token <token>`; results[] with id,
// title, slug, status, nr_forecasters, question). Every request needs the
// token, and Metaculus answers browsers without CORS headers, so OmniOS
// reaches it through its server broker.

export const METACULUS_SPEC = {
    openapi: '3.0.3',
    info: {
        title: 'Metaculus Forecasts',
        version: '1.0.0',
        description: 'Community forecasts on future events: politics, science, technology, economics. Free token.'
    },
    servers: [{ url: 'https://www.metaculus.com/api' }],
    security: [{ metaculusToken: [] }],
    components: {
        securitySchemes: {
            metaculusToken: {
                type: 'http',
                scheme: 'Token',
                description: 'Your Metaculus API token (free with an account). Find it in your Metaculus account settings, under API access.'
            }
        }
    },
    paths: {
        '/posts/': {
            get: {
                operationId: 'listPosts',
                summary: 'Forecasting questions',
                parameters: [
                    { name: 'search', in: 'query', description: 'Only questions about these words.', example: 'AI', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', description: 'How many questions.', example: 20, schema: { type: 'integer' } },
                    { name: 'offset', in: 'query', description: 'Skip this many, for the next page.', schema: { type: 'integer' } }
                ],
                responses: {
                    '200': {
                        description: 'Questions',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        count: { type: 'integer' },
                                        next: { type: 'string', nullable: true },
                                        previous: { type: 'string', nullable: true },
                                        results: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    id: { type: 'integer' },
                                                    title: { type: 'string' },
                                                    slug: { type: 'string' },
                                                    status: { type: 'string' },
                                                    nr_forecasters: { type: 'integer' },
                                                    question: { type: 'object' }
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
