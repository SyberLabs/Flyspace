// Recall of keyword search over the real index, pinned so a change to the
// scorer or a rebuild of the index cannot quietly make search worse. The
// semantic floor is low on purpose: it records what keyword search can do on
// questions that share no words with the answer, which is the number a JEV
// step has to beat (measured 2026-10-07 on the index of that date).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseApiIndex } from './apiIndex';
import { createApiSearcher } from './registrySearch';
import { LITERAL_QUESTIONS, SEMANTIC_QUESTIONS, scoreRecall } from './registrySearch.eval';

const index = parseApiIndex(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'api-index.json'), 'utf8')));

describe('registry search eval (real index)', () => {
    it('loads a valid index', () => {
        expect(index).not.toBeNull();
    });

    const entries = index?.entries ?? [];
    const byId = new Map(entries.map(e => [e.id, e]));
    // This eval scores text relevance, as its answer key was written for. The
    // compile counts are left out here: putting usable APIs first is a product
    // choice tested in registrySearch.test.ts. Six of the ten literal answers
    // (Nexmo, SendGrid, Google Translate and Calendar, NYT) compile to nothing
    // today; re-curating the key belongs with the intent list, not this test.
    const searcher = createApiSearcher(entries.map(({ operations: _operations, blocker: _blocker, ...entry }) => entry));
    const rank = (query: string) => searcher.search(query).map(result => result.entry.id);

    it('only expects answers that exist in the index and can be installed', () => {
        for (const question of [...LITERAL_QUESTIONS, ...SEMANTIC_QUESTIONS]) {
            expect(question.accept.length).toBeGreaterThan(0);
            for (const id of question.accept) {
                expect(byId.get(id)?.supported, `${question.query} → ${id}`).toBe(true);
            }
        }
    });

    it('finds the right API in the top 5 for every literal question', () => {
        const score = scoreRecall(LITERAL_QUESTIONS, rank, 5);
        expect(score.misses).toEqual([]);
    });

    it('puts the right API first for at least 8 of 10 literal questions', () => {
        expect(scoreRecall(LITERAL_QUESTIONS, rank, 1).hits).toBeGreaterThanOrEqual(8);
    });

    it('records the semantic baseline a re-rank has to beat', () => {
        const score = scoreRecall(SEMANTIC_QUESTIONS, rank, 5);
        // Measured 1/6. Keyword search cannot find "is it going to rain
        // tomorrow" → a weather API; that gap is what the JEV step is for.
        expect(score.hits).toBeGreaterThanOrEqual(1);
    });
});
