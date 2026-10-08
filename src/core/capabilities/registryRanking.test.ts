import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseApiIndex, type ApiIndexEntry } from './apiIndex';
import { curatedApi } from './curatedApis';
import { createApiSearcher } from './registrySearch';
import { intentCriteria, OTHER_INTENT, REGISTRY_INTENTS, type RegistryIntent } from './registryIntents';
import { fetchIntentScores, rankResults, routedIntents, unavailableIntents } from './registryRanking';

// ============================================
// The intent list, checked against the real index
// ============================================

const index = parseApiIndex(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'api-index.json'), 'utf8')));
const realById = new Map((index?.entries ?? []).map(e => [e.id, e]));

describe('REGISTRY_INTENTS', () => {
    it('has unique ids, none of them the reserved "other"', () => {
        const ids = REGISTRY_INTENTS.map(i => i.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain(OTHER_INTENT);
    });

    it('pins only APIs that give something to place, or says why none does', () => {
        for (const intent of REGISTRY_INTENTS) {
            if (intent.unavailable) {
                expect(intent.apis, intent.id).toEqual([]);
                expect(intent.unavailable.length, intent.id).toBeGreaterThan(20);
                continue;
            }
            expect(intent.apis.length, intent.id).toBeGreaterThan(0);
            for (const id of intent.apis) {
                const usable = curatedApi(id) !== undefined || (realById.get(id)?.operations ?? 0) > 0;
                expect(usable, `${intent.id} → ${id}`).toBe(true);
            }
        }
    });

    it('offers JEV every intent plus "none of these", within the 255-option limit', () => {
        const criteria = intentCriteria();
        expect(Object.keys(criteria)).toEqual([...REGISTRY_INTENTS.map(i => i.id), OTHER_INTENT]);
        expect(Object.keys(criteria).length).toBeLessThanOrEqual(255);
        for (const text of Object.values(criteria)) expect(text.trim().length).toBeGreaterThan(0);
    });
});

// ============================================
// Ranking, on a small fixed catalog
// ============================================

function entry(id: string, title: string, extra: Partial<ApiIndexEntry> = {}): ApiIndexEntry {
    return {
        id, title, description: '', categories: [],
        specUrl: `https://api.apis.guru/v2/specs/${id}/1.0.0/openapi.json`,
        openapiVersion: '3.0.0', supported: true, updated: '', ...extra
    };
}

const CATALOG = [
    entry('weather.example', 'Weather API', { description: 'forecasts' }),
    entry('rain.example', 'Rain Radar'),
    entry('archive.example', 'Newspaper Archive', { description: 'is it going to rain tomorrow headlines' }),
    entry('sms.example', 'SMS API')
];
const byId = new Map(CATALOG.map(e => [e.id, e]));
const searcher = createApiSearcher(CATALOG);
const INTENTS: RegistryIntent[] = [
    { id: 'weather', criteria: 'Weather.', terms: 'rain radar', apis: ['weather.example'] },
    { id: 'sms', criteria: 'SMS.', terms: 'sms', apis: ['sms.example'] }
];
const rank = (query: string, scores: Parameters<typeof rankResults>[3]) =>
    rankResults(query, searcher, byId, scores, { intents: INTENTS }).map(r => `${r.source}:${r.entry.id}`);

describe('routedIntents', () => {
    it('keeps intents above the threshold, most likely first, at most two', () => {
        expect(routedIntents([
            { id: 'a', p: 0.2 }, { id: 'b', p: 0.6 }, { id: 'c', p: 0.16 }, { id: 'd', p: 0.1 }
        ]).map(s => s.id)).toEqual(['b', 'a']);
    });

    it('routes nowhere when JEV is confident nothing listed fits', () => {
        expect(routedIntents([{ id: OTHER_INTENT, p: 0.7 }, { id: 'a', p: 0.3 }])).toEqual([]);
    });

    it('still routes when "other" is a weak runner-up', () => {
        expect(routedIntents([{ id: 'a', p: 0.6 }, { id: OTHER_INTENT, p: 0.4 }]).map(s => s.id)).toEqual(['a']);
    });

    it('routes nowhere without an answer', () => {
        expect(routedIntents(null)).toEqual([]);
        expect(routedIntents([])).toEqual([]);
    });
});

describe('rankResults', () => {
    it('is plain keyword search without a JEV answer, blind spot included', () => {
        // The archive's description happens to contain the question's words,
        // so it outranks the rain radar and the weather API is not found at
        // all. This is the gap routing exists to close.
        expect(rank('is it going to rain tomorrow', null)).toEqual(['keyword:archive.example', 'keyword:rain.example']);
    });

    it('puts a routed intent\'s pinned API first, then its terms\' results', () => {
        expect(rank('is it going to rain tomorrow', [{ id: 'weather', p: 0.9 }])).toEqual([
            'intent:weather.example',
            'intent:rain.example',
            'intent:archive.example'
        ]);
    });

    it('fills in keyword results the routed intent did not reach', () => {
        expect(rank('sms', [{ id: 'weather', p: 0.9 }])).toEqual([
            'intent:weather.example',
            'intent:rain.example',
            'intent:archive.example',
            'keyword:sms.example'
        ]);
    });

    it('never hides a keyword result: routing only adds and reorders', () => {
        const keyword = rank('is it going to rain tomorrow', null).map(r => r.split(':')[1]);
        const routed = rank('is it going to rain tomorrow', [{ id: 'weather', p: 0.9 }]).map(r => r.split(':')[1]);
        for (const id of keyword) expect(routed).toContain(id);
    });

    it('ignores an intent id the host does not know', () => {
        expect(rank('sms', [{ id: 'invented_by_model', p: 0.99 }])).toEqual(['keyword:sms.example']);
    });

    it('lists each API once even when two routes reach it', () => {
        const ids = rank('sms', [{ id: 'sms', p: 0.8 }]).map(r => r.split(':')[1]);
        expect(ids).toEqual(['sms.example']);
    });

    it('respects the limit', () => {
        const results = rankResults('rain', searcher, byId, [{ id: 'weather', p: 0.9 }], { intents: INTENTS, limit: 1 });
        expect(results).toHaveLength(1);
    });
});

describe('fetchIntentScores', () => {
    const ok = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

    it('returns the scores and model from the server', async () => {
        const fetchImpl = ok({ scores: [{ id: 'weather', p: 0.8 }], model: 'jev-1.13.0' });
        await expect(fetchIntentScores('rain?', fetchImpl)).resolves.toEqual({ scores: [{ id: 'weather', p: 0.8 }], model: 'jev-1.13.0' });
        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('/api/registry-intent');
        expect(init.method).toBe('POST');
        expect(JSON.parse(String(init.body))).toEqual({ query: 'rain?' });
    });

    it('drops malformed score entries', async () => {
        const fetchImpl = ok({ scores: [{ id: 'weather', p: 0.8 }, { id: 3, p: 'x' }, null], model: 'jev-1.13.0' });
        expect((await fetchIntentScores('q', fetchImpl))?.scores).toEqual([{ id: 'weather', p: 0.8 }]);
    });

    it('returns null when the feature is off or the call fails, so keyword results stand', async () => {
        expect(await fetchIntentScores('q', ok({ error: 'off' }, 503))).toBeNull();
        expect(await fetchIntentScores('q', ok({ nonsense: true }))).toBeNull();
        expect(await fetchIntentScores('q', vi.fn(async () => { throw new TypeError('offline'); }))).toBeNull();
    });
});

describe('INTENT_QUESTIONS', () => {
    it('only accepts intents the host offers', async () => {
        const { INTENT_QUESTIONS } = await import('./registryIntents.eval');
        const known = new Set([...REGISTRY_INTENTS.map(i => i.id), OTHER_INTENT]);
        for (const question of INTENT_QUESTIONS) {
            for (const id of question.accept) expect(known.has(id), `${question.query} → ${id}`).toBe(true);
        }
    });
});

describe('a curated API that compiles to nothing', () => {
    it('is not offered as the answer to its intent, but keyword search still finds it', () => {
        const catalog = [
            entry('dead-weather.example', 'Weather Service', { operations: 0 }),
            entry('live-weather.example', 'Forecast Service', { description: 'weather forecasts', operations: 3 })
        ];
        const intents: RegistryIntent[] = [{ id: 'weather', criteria: 'weather forecasts', terms: 'forecast', apis: ['dead-weather.example'] }];
        const results = rankResults('weather service', createApiSearcher(catalog), new Map(catalog.map(e => [e.id, e])), [{ id: 'weather', p: 0.95 }], { intents });
        expect(results.map(r => `${r.source}:${r.entry.id}`)).toEqual(['intent:live-weather.example', 'keyword:dead-weather.example']);
    });
});

describe('an intent no usable API answers', () => {
    const intents: RegistryIntent[] = [{ id: 'calendar', criteria: 'calendars', terms: 'calendar events', apis: [], unavailable: 'The calendar APIs in the directory need a Google sign-in.' }];
    const catalog = [entry('events.example', 'Events API', { description: 'calendar events log', operations: 2 })];

    it('is said plainly, and its terms do not pad the results', () => {
        const scores = [{ id: 'calendar', p: 0.9 }];
        expect(unavailableIntents(scores, intents)).toEqual([{ id: 'calendar', reason: 'The calendar APIs in the directory need a Google sign-in.' }]);
        const results = rankResults('schedule a meeting', createApiSearcher(catalog), new Map(catalog.map(e => [e.id, e])), scores, { intents });
        expect(results.filter(r => r.source === 'intent')).toEqual([]);
    });

    it('is not reported when routing found nothing', () => {
        expect(unavailableIntents(null, intents)).toEqual([]);
        expect(unavailableIntents([{ id: 'other', p: 0.9 }], intents)).toEqual([]);
    });
});
