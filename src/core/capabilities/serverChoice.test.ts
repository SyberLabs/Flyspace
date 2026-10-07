import { describe, expect, it } from 'vitest';
import { compileOpenApi } from './openapi';

function spec(servers: unknown) {
    return {
        openapi: '3.0.0',
        info: { title: 'Search', version: '1' },
        servers,
        paths: {
            '/articlesearch.json': {
                get: {
                    summary: 'Search articles',
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } }
                }
            }
        }
    };
}

const baseOf = (servers: unknown) => {
    const { manifests, errors } = compileOpenApi(spec(servers));
    const transport = manifests[0]?.transport;
    return transport?.kind === 'http' ? transport.baseUrl : errors.map(error => error.message).join('; ');
};

describe('which server a compiled API calls', () => {
    it('takes the first https server when http is listed first (the NYT specs do this)', () => {
        expect(baseOf([{ url: 'http://api.nytimes.com/svc/search/v2' }, { url: 'https://api.nytimes.com/svc/search/v2' }]))
            .toBe('https://api.nytimes.com/svc/search/v2');
    });

    it('fills a templated host from the defaults the spec gives', () => {
        expect(baseOf([{ url: 'https://{region}.api.example.test/{version}', variables: { region: { default: 'eu' }, version: { default: 'v2', enum: ['v1', 'v2'] } } }]))
            .toBe('https://eu.api.example.test/v2');
    });

    it('refuses a template without a usable default', () => {
        expect(baseOf([{ url: 'https://{tenant}.example.test' }])).toBe('provide a concrete server URL');
        expect(baseOf([{ url: 'https://{tenant}.example.test', variables: { tenant: { default: 'a/b' } } }])).toBe('provide a concrete server URL');
    });

    it('skips a server it cannot use for a later one it can', () => {
        expect(baseOf([{ url: '/v1' }, { url: 'https://{x}.example.test' }, { url: 'https://api.example.test/v1' }]))
            .toBe('https://api.example.test/v1');
    });

    it('still refuses an http-only API', () => {
        expect(baseOf([{ url: 'http://api.example.test' }])).toMatch(/must be https/);
    });

    it('still reports a relative server when that is all there is', () => {
        expect(baseOf([{ url: '/api' }])).toBe('relative server URLs are not supported');
    });
});

describe('an API whose requests must be signed', () => {
    it('is refused, not offered a key box that could never work (AWS Signature v4)', () => {
        const aws = {
            ...spec([{ url: 'http://acm.{region}.amazonaws.com', variables: { region: { default: 'us-east-1' } } }, { url: 'https://acm.{region}.amazonaws.com', variables: { region: { default: 'us-east-1' } } }]),
            security: [{ hmac: [] }],
            components: {
                securitySchemes: {
                    hmac: { type: 'apiKey', name: 'Authorization', in: 'header', description: 'Amazon Signature authorization v4', 'x-amazon-apigateway-authtype': 'awsSigv4' }
                }
            }
        };
        const { manifests, errors } = compileOpenApi(aws);
        expect(manifests).toEqual([]);
        expect(errors[0].message).toBe('unsupported scheme hmac: every request must be signed');
    });
});
