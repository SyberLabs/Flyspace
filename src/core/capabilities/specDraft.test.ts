import { describe, expect, it } from 'vitest';
import { checkDraft, docsText, jsonObjectIn, MAX_DRAFT_OPERATIONS } from './specDraft';
import { CURATED_APIS } from './curatedApis';

const ok = { '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } } };
const draft = (extra: Record<string, unknown> = {}, paths?: Record<string, unknown>) => ({
    openapi: '3.0.3',
    info: { title: 'Books', version: '1' },
    servers: [{ url: 'https://api.books.example.test' }],
    paths: paths ?? {
        '/search': { get: { operationId: 'search', parameters: [{ name: 'q', in: 'query', required: true, example: 'dune', schema: { type: 'string' } }], responses: ok } }
    },
    ...extra
});

describe('checkDraft', () => {
    it('passes a small, keyless, read-only draft with examples', () => {
        expect(checkDraft(draft())).toEqual([]);
    });

    it('passes every spec Flyspace already ships', () => {
        for (const api of CURATED_APIS) expect(checkDraft(api.spec), api.entry.id).toEqual([]);
    });

    it('refuses what is not an OpenAPI 3 object', () => {
        expect(checkDraft('nope')).toEqual(['the draft is not a JSON object']);
        expect(checkDraft({ swagger: '2.0' })).toEqual(['the draft is not OpenAPI 3.x']);
    });

    it('names a required input without an example', () => {
        const spec = draft({}, { '/search': { get: { operationId: 'search', parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: ok } } });
        expect(checkDraft(spec)).toEqual(['search: required input q has no example']);
    });

    it('refuses a write', () => {
        const spec = draft({}, { '/notes': { post: { operationId: 'addNote', responses: ok } } });
        expect(checkDraft(spec)).toContain('addNote: is write; a curated spec holds reads only');
    });

    it('asks a keyed draft to say where the key comes from', () => {
        const keyed = (description?: string) => draft({
            security: [{ k: [] }],
            components: { securitySchemes: { k: { type: 'apiKey', in: 'query', name: 'api_key', ...(description ? { description } : {}) } } }
        });
        expect(checkDraft(keyed())).toEqual(["search: the key's scheme description does not say where to get a key (no link)"]);
        expect(checkDraft(keyed('Your key. Get one at https://books.example.test/keys'))).toEqual([]);
    });

    it('keeps a draft small enough to review', () => {
        const paths = Object.fromEntries(Array.from({ length: MAX_DRAFT_OPERATIONS + 1 }, (_, i) => [`/r${i}`, { get: { operationId: `r${i}`, responses: ok } }]));
        expect(checkDraft(draft({}, paths))).toContain(`has ${MAX_DRAFT_OPERATIONS + 1} operations; keep it to the ${MAX_DRAFT_OPERATIONS} most useful reads`);
    });

    it('passes on what the compiler refuses', () => {
        expect(checkDraft(draft({ servers: [{ url: 'http://api.books.example.test' }] })).join(' ')).toMatch(/does not compile/);
    });
});

describe('docsText and jsonObjectIn', () => {
    it('keeps the words of a docs page and drops its scripts and tags', () => {
        const html = '<html><script>evil()</script><style>p{}</style><h1>Search API</h1><p>Use <code>q</code> &amp; <b>page</b>.</p></html>';
        expect(docsText(html)).toBe('Search API\nUse q & page .');
    });

    it('finds the JSON object in a reply, and refuses one without', () => {
        expect(jsonObjectIn('Here it is:\n{"openapi":"3.0.3","info":{"title":"x"}}\nDone.')).toEqual({ openapi: '3.0.3', info: { title: 'x' } });
        expect(() => jsonObjectIn('no json here')).toThrow('the reply holds no JSON object');
    });
});
