// ============================================
// FLYSPACE: QUALITY LINE
//
//     npm run verify:curated              # report only
//     npm run verify:curated -- --write   # also write public/curated-quality.json
//
// APEX_PLAN 6.4. Calls every curated operation against the live provider,
// through the same compiled manifest and runtime a person's block uses
// (compileOpenApi, installProposal, executeCapability), so the output is
// checked against the declared schema exactly as it is in the app. Inputs
// come from the spec's own examples; an operation whose required input has
// no example is reported as untestable rather than guessed at.
//
// Keys come from the environment (each curated entry's `keyEnv`); without
// one, a keyed operation is "skipped", never "failed". In Node there is no
// CORS, so a broker-routed API is called directly here: this verifies the
// provider and the spec, not the broker.
//
// Exit 1 when any operation failed. Nothing is written without --write.
// ============================================

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CURATED_APIS } from '../src/core/capabilities/curatedApis';
import { verifySpec, type QualityResult } from './lib/verifySpec';

const OUTPUT = path.join(process.cwd(), 'public', 'curated-quality.json');

async function verify(): Promise<QualityResult[]> {
    const results: QualityResult[] = [];
    for (const api of CURATED_APIS) results.push(...await verifySpec(api.entry.id, api.spec, api.entry.specUrl, api.keyEnv));
    return results;
}

async function main(): Promise<void> {
    const results = await verify();
    const count = (status: QualityResult['status']) => results.filter(r => r.status === status).length;
    console.log('| API | Operation | Status | Detail |');
    console.log('| --- | --- | --- | --- |');
    for (const r of results) console.log(`| ${r.api} | ${r.title} | ${r.status} | ${r.detail}${r.ms !== undefined ? ` (${r.ms} ms)` : ''} |`);
    console.log('');
    console.log(`ok ${count('ok')}, failed ${count('failed')}, skipped ${count('skipped')}, untestable ${count('untestable')} of ${results.length}.`);
    if (process.argv.includes('--write')) {
        writeFileSync(OUTPUT, `${JSON.stringify({ format: 'flyspace-curated-quality', version: 1, checkedAt: new Date().toISOString(), results }, null, 2)}\n`, 'utf8');
        console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}.`);
    }
    if (count('failed') > 0) process.exit(1);
}

main().catch((err: unknown) => {
    console.error('verify:curated failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
