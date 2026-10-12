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
import { executeCapability } from '../src/core/capabilities/execute';
import { noticeIn } from '../src/core/capabilities/keyGuide';
import type { CapabilityManifest } from '../src/core/capabilities/manifest';
import { compileOpenApi } from '../src/core/capabilities/openapi';
import { installProposal } from '../src/core/capabilities/registry';
import { capabilitySecrets } from '../src/core/capabilities/secrets';

export interface QualityResult {
    api: string;
    operationId: string;
    title: string;
    status: 'ok' | 'failed' | 'skipped' | 'untestable';
    detail: string;
    ms?: number;
}

const OUTPUT = path.join(process.cwd(), 'public', 'curated-quality.json');

/** Inputs from the spec itself: every required input's example, plus one-value constants. */
function sampleInput(manifest: CapabilityManifest): { ok: true; input: Record<string, unknown> } | { ok: false; missing: string[] } {
    const input: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const field of manifest.inputs) {
        if (field.required && field.schema.enum?.length === 1) input[field.name] = field.schema.enum[0];
        else if (field.example !== undefined) input[field.name] = field.example;
        else if (field.required) missing.push(field.name);
    }
    return missing.length > 0 ? { ok: false, missing } : { ok: true, input };
}

async function verify(): Promise<QualityResult[]> {
    const results: QualityResult[] = [];
    for (const api of CURATED_APIS) {
        // Direct: Node has no CORS, so the broker is not needed to reach the provider.
        const manifests = compileOpenApi(api.spec, { sourceLocator: api.entry.specUrl }).manifests;
        const key = api.keyEnv ? process.env[api.keyEnv]?.trim() : undefined;
        for (const manifest of manifests) {
            const base = { api: api.entry.id, operationId: manifest.source.operationId ?? manifest.id, title: manifest.title };
            if (manifest.auth.kind !== 'none' && !key) {
                results.push({ ...base, status: 'skipped', detail: `no key (set ${api.keyEnv ?? 'a key'})` });
                continue;
            }
            const sample = sampleInput(manifest);
            if (!sample.ok) {
                results.push({ ...base, status: 'untestable', detail: `required input without an example: ${sample.missing.join(', ')}` });
                continue;
            }
            const installed = installProposal(manifest);
            if (!installed.ok) {
                results.push({ ...base, status: 'failed', detail: `does not install: ${installed.errors?.join('; ') ?? 'refused'}` });
                continue;
            }
            if (key && manifest.auth.secretRef) capabilitySecrets.set(manifest.auth.secretRef, key);
            const started = Date.now();
            const result = await executeCapability(manifest.id, sample.input);
            const ms = Date.now() - started;
            if (!result.ok || result.error) {
                results.push({ ...base, status: 'failed', detail: result.error ? `${result.error.code}: ${result.error.message}` : 'no answer', ms });
                continue;
            }
            // A refusal can come back as a 200 with a notice instead of data: that is not a pass.
            const notice = noticeIn(result.typed?.value);
            if (notice) {
                results.push({ ...base, status: 'failed', detail: `answered with a notice instead of data: ${notice.slice(0, 160)}`, ms });
                continue;
            }
            results.push({ ...base, status: 'ok', detail: 'answered with data matching its declared output schema', ms });
        }
    }
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
