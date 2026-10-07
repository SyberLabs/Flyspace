import { describe, expect, it } from 'vitest';
import {
    buildApiIndexEntries,
    isCatalogSpecUrl,
    MAX_DESCRIPTION_CHARS,
    parseApiIndex,
    type ApiIndex
} from './apiIndex';

// Shaped like https://api.apis.guru/v2/list.json, trimmed to what the index reads.
function api(id: string, version: Record<string, unknown>, preferred = '1.0.0') {
    return [id, { preferred, versions: { [preferred]: version } }] as const;
}

const GOOD = api('1password.com:events', {
    swaggerUrl: 'https://api.apis.guru/v2/specs/1password.com/events/1.0.0/openapi.json',
    openapiVer: '3.0.0',
    updated: '2023-04-21T23:18:02.090Z',
    info: { title: 'Events API', description: '1Password Events API Specification.', 'x-apisguru-categories': ['security'] }
});

const SWAGGER2 = api('1forge.com', {
    swaggerUrl: 'https://api.apis.guru/v2/specs/1forge.com/0.0.1/swagger.json',
    openapiVer: '2.0',
    updated: '2017-05-30T08:34:14.000Z',
    info: { title: '1Forge Finance APIs', description: 'Stock and Forex Data', 'x-apisguru-categories': ['financial'] }
}, '0.0.1');

describe('buildApiIndexEntries', () => {
    it('keeps what search and install need, and nothing else', () => {
        const { entries, issues } = buildApiIndexEntries(Object.fromEntries([GOOD]));
        expect(issues).toEqual([]);
        expect(entries).toEqual([{
            id: '1password.com:events',
            title: 'Events API',
            description: '1Password Events API Specification.',
            categories: ['security'],
            specUrl: 'https://api.apis.guru/v2/specs/1password.com/events/1.0.0/openapi.json',
            openapiVersion: '3.0.0',
            supported: true,
            updated: '2023-04-21'
        }]);
    });

    it('lists a Swagger 2.0 API but marks it unsupported', () => {
        const [entry] = buildApiIndexEntries(Object.fromEntries([SWAGGER2])).entries;
        expect(entry.supported).toBe(false);
        expect(entry.openapiVersion).toBe('2.0');
    });

    it('sorts by id, so a rebuild of the same list is byte-identical', () => {
        const { entries } = buildApiIndexEntries(Object.fromEntries([GOOD, SWAGGER2]));
        expect(entries.map(e => e.id)).toEqual(['1forge.com', '1password.com:events']);
    });

    it('flattens and caps a long description to one line', () => {
        const long = api('long.example', {
            swaggerUrl: 'https://api.apis.guru/v2/specs/long.example/1.0.0/openapi.json',
            openapiVer: '3.0.1',
            info: { title: 'Long', description: `line one\n\n${'word '.repeat(200)}` }
        });
        const [entry] = buildApiIndexEntries(Object.fromEntries([long])).entries;
        expect(entry.description).not.toContain('\n');
        expect(entry.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);
        expect(entry.description.endsWith('…')).toBe(true);
    });

    it('falls back to the id when the spec has no title', () => {
        const untitled = api('untitled.example', {
            swaggerUrl: 'https://api.apis.guru/v2/specs/untitled.example/1.0.0/openapi.json',
            openapiVer: '3.0.0'
        });
        expect(buildApiIndexEntries(Object.fromEntries([untitled])).entries[0].title).toBe('untitled.example');
    });

    it('reports, rather than drops silently, an entry whose spec URL is off the catalog host', () => {
        const offHost = api('evil.example', {
            swaggerUrl: 'https://evil.example/spec.json',
            openapiVer: '3.0.0',
            info: { title: 'Evil' }
        });
        const { entries, issues } = buildApiIndexEntries(Object.fromEntries([GOOD, offHost]));
        expect(entries.map(e => e.id)).toEqual(['1password.com:events']);
        expect(issues).toEqual([{ id: 'evil.example', reason: 'spec URL is not an https JSON URL on the catalog host' }]);
    });

    it('reports an entry with no usable preferred version', () => {
        const { issues } = buildApiIndexEntries({ 'broken.example': { preferred: '2.0.0', versions: {} } });
        expect(issues).toEqual([{ id: 'broken.example', reason: 'preferred version missing' }]);
    });
});

describe('isCatalogSpecUrl', () => {
    it.each([
        ['http instead of https', 'http://api.apis.guru/v2/specs/a/1/openapi.json'],
        ['another host', 'https://apis.guru.evil.example/v2/specs/a/1/openapi.json'],
        ['embedded credentials', 'https://user:pass@api.apis.guru/v2/specs/a/1/openapi.json'],
        ['a query string', 'https://api.apis.guru/v2/specs/a/1/openapi.json?redirect=x'],
        ['a YAML spec', 'https://api.apis.guru/v2/specs/a/1/openapi.yaml'],
        ['not a URL', 'api.apis.guru/v2/specs/a/1/openapi.json']
    ])('refuses %s', (_label, url) => {
        expect(isCatalogSpecUrl(url)).toBe(false);
    });

    it('accepts an https JSON spec on the catalog host', () => {
        expect(isCatalogSpecUrl('https://api.apis.guru/v2/specs/1forge.com/0.0.1/swagger.json')).toBe(true);
    });
});

describe('parseApiIndex', () => {
    function index(entries: unknown[]): unknown {
        return {
            format: 'omni-api-index',
            version: 1,
            source: { url: 'https://api.apis.guru/v2/list.json', license: 'CC0-1.0', etag: null, lastModified: null },
            builtAt: '2026-10-07T00:00:00.000Z',
            entries
        };
    }
    const entry = buildApiIndexEntries(Object.fromEntries([GOOD])).entries[0];

    it('accepts an index the builder produced', () => {
        const parsed = parseApiIndex(index([entry])) as ApiIndex;
        expect(parsed.entries).toHaveLength(1);
    });

    it('refuses an entry whose spec URL points off the catalog host', () => {
        expect(parseApiIndex(index([{ ...entry, specUrl: 'https://evil.example/spec.json' }]))).toBeNull();
    });

    it('refuses an entry that claims support for a 2.0 spec', () => {
        expect(parseApiIndex(index([{ ...entry, openapiVersion: '2.0', supported: true }]))).toBeNull();
    });

    it('refuses duplicate ids', () => {
        expect(parseApiIndex(index([entry, entry]))).toBeNull();
    });

    it('refuses the wrong format or version', () => {
        expect(parseApiIndex({ ...(index([entry]) as object), format: 'something-else' })).toBeNull();
        expect(parseApiIndex({ ...(index([entry]) as object), version: 2 })).toBeNull();
        expect(parseApiIndex(null)).toBeNull();
    });
});
