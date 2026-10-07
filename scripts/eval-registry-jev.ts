// ============================================
// PROJECT OMNI: MEASURE JEV INTENT ROUTING
//
//     npm run eval:registry-jev
//
// Scores keyword search alone against keyword search plus JEV intent routing,
// on the fixed question set in registrySearch.eval.ts, as recall@1 and @5.
// Calls TypeSafe once per question with TYPESAFE_API_KEY from the environment;
// sends only the question text. 16 questions cost well under a cent.
//
// Prints, per question, the intent JEV chose and its probability, so a miss
// can be told apart: wrong intent (fix the criteria) vs right intent, wrong
// APIs (fix the pinned answers).
// ============================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseApiIndex } from '../src/core/capabilities/apiIndex';
import { createApiSearcher } from '../src/core/capabilities/registrySearch';
import { LITERAL_QUESTIONS, SEMANTIC_QUESTIONS, scoreRecall, type EvalQuestion } from '../src/core/capabilities/registrySearch.eval';
import { rankResults, routedIntents, type IntentScore } from '../src/core/capabilities/registryRanking';
import { classifyIntent } from '../src/core/services/server/registryIntent';
import { INTENT_QUESTIONS } from '../src/core/capabilities/registryIntents.eval';

async function main(): Promise<void> {
    if (!process.env.TYPESAFE_API_KEY) {
        console.error('TYPESAFE_API_KEY is not set. Add it to .env (see .env.example) and run again.');
        process.exit(2);
    }
    const index = parseApiIndex(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'api-index.json'), 'utf8')));
    if (!index) throw new Error('public/api-index.json is missing or invalid');
    const searcher = createApiSearcher(index.entries);
    const byId = new Map(index.entries.map(e => [e.id, e]));

    const questions: EvalQuestion[] = [...LITERAL_QUESTIONS, ...SEMANTIC_QUESTIONS];
    const scores = new Map<string, IntentScore[] | null>();
    let model = '';
    for (const question of questions) {
        const outcome = await classifyIntent(question.query);
        if (!outcome.ok) {
            console.log(`  ${question.query.padEnd(46)} JEV failed: ${outcome.failure}`);
            scores.set(question.query, null);
            continue;
        }
        model = outcome.model;
        scores.set(question.query, outcome.scores);
        const routed = routedIntents(outcome.scores);
        const top = outcome.scores[0];
        console.log(`  ${question.query.padEnd(46)} ${top.id.padEnd(18)} p=${top.p.toFixed(2)}  routed: ${routed.map(r => r.id).join(', ') || '(keyword only)'}`);
    }

    const keyword = (q: string) => searcher.search(q).map(r => r.entry.id);
    const routed = (q: string) => rankResults(q, searcher, byId, scores.get(q) ?? null).map(r => r.entry.id);

    console.log(`\nModel: ${model || 'unknown'}\n`);
    console.log('                 keyword   keyword + JEV');
    for (const [name, set] of [['literal', LITERAL_QUESTIONS], ['semantic', SEMANTIC_QUESTIONS]] as const) {
        for (const k of [1, 5]) {
            const a = scoreRecall(set, keyword, k);
            const b = scoreRecall(set, routed, k);
            console.log(`${`${name} @${k}`.padEnd(16)} ${`${a.hits}/${a.total}`.padEnd(9)} ${b.hits}/${b.total}${b.misses.length ? `   misses: ${b.misses.join(' | ')}` : ''}`);
        }
    }
    console.log('\nHeld-out intent routing (registryIntents.eval.ts):');
    let right = 0;
    for (const question of INTENT_QUESTIONS) {
        const outcome = await classifyIntent(question.query);
        const top = outcome.ok ? outcome.scores[0] : undefined;
        const ok = !!top && question.accept.includes(top.id);
        if (ok) right++;
        console.log(`  ${ok ? 'ok  ' : 'MISS'} ${question.query.padEnd(48)} ${top ? `${top.id} p=${top.p.toFixed(2)}` : `failed: ${outcome.ok ? '' : outcome.failure}`}`);
    }
    console.log(`  intent accuracy: ${right}/${INTENT_QUESTIONS.length}`);
}

main().catch((err: unknown) => {
    console.error('eval failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
