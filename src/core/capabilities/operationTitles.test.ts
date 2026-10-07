import { describe, expect, it } from 'vitest';
import { compileOpenApi } from './openapi';

function spec(paths: Record<string, unknown>) {
    return {
        openapi: '3.0.0',
        info: { title: 'Titles', version: '1' },
        servers: [{ url: 'https://api.example.test' }],
        paths
    };
}

const ok = { responses: { '200': { description: 'ok' } } };
const param = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
const titlesOf = (document: unknown) => compileOpenApi(document).manifests.map(m => m.title);

describe('operation titles', () => {
    it('keeps a unique summary exactly as it is', () => {
        expect(titlesOf(spec({
            '/a': { get: { summary: 'List things', ...ok } },
            '/b': { get: { summary: 'Get weather', ...ok } }
        }))).toEqual(['List things', 'Get weather']);
    });

    it('tells same-summary operations apart by where their paths differ', () => {
        // The shape of Visual Crossing's directory spec: one summary, three
        // timeline paths, no operationId.
        const prefix = '/VisualCrossingWebServices/rest/services/timeline';
        const titles = titlesOf(spec({
            [`${prefix}/{location}`]: { get: { summary: 'Historical and Forecast Weather API', parameters: [param('location')], ...ok } },
            [`${prefix}/{location}/{startdate}`]: { get: { summary: 'Historical and Forecast Weather API', parameters: [param('location'), param('startdate')], ...ok } },
            [`${prefix}/{location}/{startdate}/{enddate}`]: { get: { summary: 'Historical and Forecast Weather API', parameters: [param('location'), param('startdate'), param('enddate')], ...ok } }
        }));
        expect(titles).toEqual([
            'Historical and Forecast Weather API · {location}',
            'Historical and Forecast Weather API · {location}/{startdate}',
            'Historical and Forecast Weather API · {location}/{startdate}/{enddate}'
        ]);
        expect(new Set(titles).size).toBe(3);
    });

    it('adds the method when the same path carries the same summary twice', () => {
        const titles = titlesOf(spec({
            '/posts': {
                get: { summary: 'Posts', ...ok },
                post: { summary: 'Posts', ...ok }
            }
        }));
        expect(titles).toEqual(['Posts · GET posts', 'Posts · POST posts']);
    });

    it('stays within the 120-character title limit', () => {
        const long = 'x'.repeat(200);
        const titles = titlesOf(spec({
            '/one/{a}': { get: { summary: long, parameters: [param('a')], ...ok } },
            '/one/{a}/{b}': { get: { summary: long, parameters: [param('a'), param('b')], ...ok } }
        }));
        for (const title of titles) expect(title.length).toBeLessThanOrEqual(120);
        expect(new Set(titles).size).toBe(2);
    });

    it('falls back to operationId, then method and path, as before', () => {
        expect(titlesOf(spec({
            '/a': { get: { operationId: 'listA', ...ok } },
            '/b': { get: { ...ok } }
        }))).toEqual(['listA', 'GET /b']);
    });
});
