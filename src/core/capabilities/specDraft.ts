// What a drafted curated spec must satisfy before a person reviews it
// (APEX_PLAN 6.6, the spec forge). Mechanical checks only: a draft that
// passes them still needs a person to read it against the provider's docs.

import { firstLink } from './keyGuide';
import { compileOpenApi } from './openapi';

/** A curated spec stays small enough to review by hand. */
export const MAX_DRAFT_OPERATIONS = 8;

export function checkDraft(spec: unknown): string[] {
    if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return ['the draft is not a JSON object'];
    const record = spec as Record<string, unknown>;
    if (typeof record.openapi !== 'string' || !record.openapi.startsWith('3.')) return ['the draft is not OpenAPI 3.x'];

    const problems: string[] = [];
    const { manifests, errors } = compileOpenApi(spec);
    for (const error of errors) problems.push(`does not compile: ${error.operation ? `${error.operation}: ` : ''}${error.message}`);
    if (manifests.length === 0) problems.push('compiles to no operations');
    if (manifests.length > MAX_DRAFT_OPERATIONS) problems.push(`has ${manifests.length} operations; keep it to the ${MAX_DRAFT_OPERATIONS} most useful reads`);

    for (const manifest of manifests) {
        const name = manifest.source.operationId ?? manifest.title;
        if (manifest.effect !== 'read') problems.push(`${name}: is ${manifest.effect}; a curated spec holds reads only`);
        for (const input of manifest.inputs) {
            const constant = input.required && input.schema.enum?.length === 1;
            if (input.required && !constant && input.example === undefined) {
                problems.push(`${name}: required input ${input.name} has no example`);
            }
        }
        if (manifest.auth.kind !== 'none' && manifest.auth.kind !== 'oauth' && !firstLink(manifest.auth.hint)) {
            problems.push(`${name}: the key's scheme description does not say where to get a key (no link)`);
        }
    }
    return [...new Set(problems)];
}

/** The readable text of a docs page: scripts, styles and tags removed, entities decoded. */
export function docsText(html: string): string {
    return html
        .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6]|pre)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n\s*\n+/g, '\n\n')
        .trim();
}

/** The JSON object in a model reply: from the first `{` to the last `}`. */
export function jsonObjectIn(text: string): unknown {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('the reply holds no JSON object');
    return JSON.parse(text.slice(start, end + 1));
}
