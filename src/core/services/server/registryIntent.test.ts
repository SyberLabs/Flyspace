import { describe, expect, it, vi } from 'vitest';
import { intentCriteria, OTHER_INTENT, REGISTRY_INTENTS } from '@/core/capabilities/registryIntents';
import {
    classifyIntent,
    MAX_QUERY_CHARS,
    normalizeQuery,
    readIntentAnswer,
    TYPESAFE_MODEL,
    TYPESAFE_SYSTEMONE_URL
} from './registryIntent';

const OFFERED = new Set(Object.keys(intentCriteria()));

// Shaped like a documented System One `choice` answer.
function answer(probabilities: Record<string, number>, overrides: Record<string, unknown> = {}) {
    const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];
    return {
        id: 'dec-1',
        model: 'jev-1.13.0',
        answers: { intent: { type: 'choice', choice, confidence: 0.7, probabilities } },
        usage: { input_tokens: 700, output_tokens: 10 },
        ...overrides
    };
}

describe('readIntentAnswer', () => {
    it('returns the probabilities, most likely first', () => {
        expect(readIntentAnswer(answer({ sms: 0.1, weather: 0.85, other: 0.05 }), OFFERED)).toEqual({
            model: 'jev-1.13.0',
            scores: [{ id: 'weather', p: 0.85 }, { id: 'sms', p: 0.1 }, { id: 'other', p: 0.05 }]
        });
    });

    it.each([
        ['a probability for an id the host never offered', answer({ weather: 0.6, invented_by_model: 0.4 })],
        ['a choice outside the offered set', { ...answer({ weather: 0.9 }), answers: { intent: { type: 'choice', choice: 'invented', probabilities: { weather: 0.9 } } } }],
        ['a probability above 1', answer({ weather: 1.5 })],
        ['a negative probability', answer({ weather: -0.1, sms: 1 })],
        ['a non-numeric probability', { ...answer({ weather: 0.9 }), answers: { intent: { type: 'choice', choice: 'weather', probabilities: { weather: '0.9' } } } }],
        ['the wrong answer type', { ...answer({ weather: 0.9 }), answers: { intent: { type: 'score', choice: 'weather', probabilities: { weather: 0.9 } } } }],
        ['no intent answer', { ...answer({ weather: 0.9 }), answers: {} }],
        ['an unexpected model name', answer({ weather: 0.9 }, { model: 'gpt-4o' })],
        ['empty probabilities', { ...answer({ weather: 0.9 }), answers: { intent: { type: 'choice', choice: 'weather', probabilities: {} } } }]
    ])('refuses %s', (_label, body) => {
        expect(readIntentAnswer(body, OFFERED)).toBeNull();
    });
});

describe('normalizeQuery', () => {
    it('collapses whitespace and trims', () => {
        expect(normalizeQuery('  is it\n going to   rain ')).toBe('is it going to rain');
    });

    it('refuses empty, oversized and non-string input', () => {
        expect(normalizeQuery('   ')).toBeNull();
        expect(normalizeQuery('x'.repeat(MAX_QUERY_CHARS + 1))).toBeNull();
        expect(normalizeQuery(42)).toBeNull();
    });
});

describe('classifyIntent', () => {
    const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

    it('is not configured without a key, and sends nothing', async () => {
        const fetchImpl = vi.fn();
        expect(await classifyIntent('rain', { apiKey: '', fetchImpl })).toEqual({ ok: false, failure: 'not_configured' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('refuses an invalid query before sending anything', async () => {
        const fetchImpl = vi.fn();
        expect(await classifyIntent('', { apiKey: 'k', fetchImpl })).toEqual({ ok: false, failure: 'query_invalid' });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('sends only the search text and the host\'s own options, to TypeSafe directly', async () => {
        const fetchImpl = reply(answer({ weather: 0.9, other: 0.1 }));
        const outcome = await classifyIntent('  is it going to rain  ', { apiKey: 'secret-key', fetchImpl });
        expect(outcome).toMatchObject({ ok: true, model: 'jev-1.13.0' });

        const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(TYPESAFE_SYSTEMONE_URL);
        expect(init.redirect).toBe('error');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-key');
        const sent = JSON.parse(String(init.body));
        expect(sent.model).toBe(TYPESAFE_MODEL);
        expect(sent.state).toBe('is it going to rain');
        expect(sent.questions.intent.type).toBe('choice');
        expect(Object.keys(sent.questions.intent.criteria)).toEqual([...REGISTRY_INTENTS.map(i => i.id), OTHER_INTENT]);
        expect(Object.keys(sent)).toEqual(['model', 'state', 'questions']);
    });

    it('reports a non-2xx answer', async () => {
        expect(await classifyIntent('rain', { apiKey: 'k', fetchImpl: reply({ error: 'nope' }, 429) }))
            .toEqual({ ok: false, failure: 'upstream_status' });
    });

    it('refuses a malformed answer', async () => {
        expect(await classifyIntent('rain', { apiKey: 'k', fetchImpl: reply(answer({ invented: 1 })) }))
            .toEqual({ ok: false, failure: 'upstream_shape' });
    });

    it('reports a network failure', async () => {
        const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed'); });
        expect(await classifyIntent('rain', { apiKey: 'k', fetchImpl })).toEqual({ ok: false, failure: 'unreachable' });
    });

    it('reports a timeout', async () => {
        const fetchImpl = vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); });
        expect(await classifyIntent('rain', { apiKey: 'k', fetchImpl })).toEqual({ ok: false, failure: 'timeout' });
    });
});
