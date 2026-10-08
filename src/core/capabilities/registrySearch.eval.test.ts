// Recall of keyword search over the real index, pinned so a change to the
// scorer or a rebuild of the index cannot quietly make search worse. The
// semantic floor is low on purpose: it records what keyword search can do on
// questions that share no words with the answer, which is the number a JEV
// step has to beat (measured 2026-10-07 on the index of that date).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseApiIndex } from './apiIndex';
import { CURATED_APIS } from './curatedApis';
import { createApiSearcher } from './registrySearch';
import { LITERAL_QUESTIONS, SEMANTIC_QUESTIONS, scoreRecall } from './registrySearch.eval';

const index = parseApiIndex(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'api-index.json'), 'utf8')));

describe('registry search eval (real index)', () => {
    it('loads a valid index', () => {
        expect(index).not.toBeNull();
    });

    // The entries search offers: OmniOS's curated APIs beside the directory.
    const entries = [...CURATED_APIS.map(api => api.entry), ...(index?.entries ?? [])];
    const byId = new Map(entries.map(e => [e.id, e]));
    // Scores the ranking people see, usable APIs first. The answer key was
    // re-curated so every answer gives something to place (checked below).
    const searcher = createApiSearcher(entries);
    const rank = (query: string) => searcher.search(query).map(result => result.entry.id);

    it('only expects answers that give something to place', () => {
        for (const question of [...LITERAL_QUESTIONS, ...SEMANTIC_QUESTIONS]) {
            expect(question.accept.length).toBeGreaterThan(0);
            for (const id of question.accept) {
                expect(byId.get(id)?.operations ?? 0, `${question.query} → ${id}`).toBeGreaterThan(0);
            }
        }
    });

    it('finds the right API in the top 5 for every literal question but one known miss', () => {
        // sms77.io sends SMS but its directory text barely says so ("sms77.io
        // Swagger API"); keyword search ranks it below the top 5. The sms
        // intent pins it when search by meaning is on. Named, so a fix shows too.
        const score = scoreRecall(LITERAL_QUESTIONS, rank, 5);
        expect(score.misses).toEqual(['send sms text message']);
    });

    it('puts the right API first for the measured share of literal questions', () => {
        // Measured 5 of 7 on 2026-10-07, after re-keying to usable answers.
        // The earlier 8 of 10 counted answers nobody could install (Nexmo,
        // SendGrid, Google). Misses: 'send sms text message', 'github issues'.
        expect(scoreRecall(LITERAL_QUESTIONS, rank, 1).hits).toBeGreaterThanOrEqual(5);
    });

    it('records the semantic baseline a re-rank has to beat', () => {
        const score = scoreRecall(SEMANTIC_QUESTIONS, rank, 5);
        // Measured 1/6. Keyword search cannot find "is it going to rain
        // tomorrow" → a weather API; that gap is what the JEV step is for.
        expect(score.hits).toBeGreaterThanOrEqual(1);
    });
});
