// Call every operation of one OpenAPI spec against the live provider, through
// the same path a person's block uses (compileOpenApi, installProposal,
// executeCapability), so each answer is checked against the declared output
// schema exactly as it is in the app. Shared by the quality line
// (verify-curated.ts) and the spec forge (forge-spec.ts).

import { executeCapability } from '../../src/core/capabilities/execute';
import { noticeIn } from '../../src/core/capabilities/keyGuide';
import type { CapabilityManifest } from '../../src/core/capabilities/manifest';
import { compileOpenApi } from '../../src/core/capabilities/openapi';
import { installProposal } from '../../src/core/capabilities/registry';
import { capabilitySecrets } from '../../src/core/capabilities/secrets';

export interface QualityResult {
    api: string;
    operationId: string;
    title: string;
    status: 'ok' | 'failed' | 'skipped' | 'untestable';
    detail: string;
    ms?: number;
}

/** Inputs from the spec itself: every required input's example, plus one-value constants. */
export function sampleInput(manifest: CapabilityManifest): { ok: true; input: Record<string, unknown> } | { ok: false; missing: string[] } {
    const input: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const field of manifest.inputs) {
        if (field.required && field.schema.enum?.length === 1) input[field.name] = field.schema.enum[0];
        else if (field.example !== undefined) input[field.name] = field.example;
        else if (field.required) missing.push(field.name);
    }
    return missing.length > 0 ? { ok: false, missing } : { ok: true, input };
}

/**
 * Run every operation once. Without a key a keyed operation is "skipped",
 * never "failed". In Node there is no CORS, so the provider is called
 * directly: this checks the provider and the spec, not the server broker.
 */
export async function verifySpec(apiId: string, spec: unknown, sourceLocator: string, keyEnv?: string): Promise<QualityResult[]> {
    const results: QualityResult[] = [];
    const manifests = compileOpenApi(spec, { sourceLocator }).manifests;
    const key = keyEnv ? process.env[keyEnv]?.trim() : undefined;
    for (const manifest of manifests) {
        const base = { api: apiId, operationId: manifest.source.operationId ?? manifest.id, title: manifest.title };
        if (manifest.auth.kind !== 'none' && !key) {
            results.push({ ...base, status: 'skipped', detail: `no key (set ${keyEnv ?? 'a key'})` });
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
    return results;
}
