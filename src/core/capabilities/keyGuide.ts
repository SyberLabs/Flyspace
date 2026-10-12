// How to get the key an API needs, said honestly. APEX_PLAN 6.2.
//
// A curated API carries a guide written from the provider's own pages
// (curatedApis.ts). Any other API gets what its spec says: the first link in
// the key's description ("Register at www.interzoid.com/register"). Nothing
// here claims what a provider's page did not say: no time estimates, and a
// key format only where the provider documents one.

import { CURATED_APIS } from './curatedApis';
import { executeCapability } from './execute';
import type { CapabilityManifest } from './manifest';

export interface KeyGuide {
    /** Where the key is issued. */
    url: string;
    /** What signing up asks for, in the provider's terms. */
    requires: string;
    /** The free tier as the provider states it. */
    freeTier?: string;
    /** A limit a person should know before relying on the key. */
    caveat?: string;
    /** The documented key format, for a warning on paste. Never blocks saving. */
    format?: { pattern: string; describe: string };
    /**
     * A cheap read that proves the key works once the API is installed.
     * `provesKey: false` when the provider answers any key, so a pass only
     * shows the API answers.
     */
    test?: { operationId: string; input: Record<string, unknown>; provesKey?: boolean };
    /** `provider`: written from the provider's pages. `spec`: a link from the API's own description. */
    source: 'provider' | 'spec';
}

/** The curated API a manifest was compiled from, if any (its source locator is the curated spec URL). */
function curatedFor(manifest: CapabilityManifest) {
    return CURATED_APIS.find(api => api.entry.specUrl === manifest.source.locator);
}

/** The first link in a piece of spec text, as https. `www.example.com/register` counts. */
export function firstLink(text: string | undefined): string | null {
    if (!text) return null;
    const match = /\b(?:https?:\/\/|www\.)[^\s<>"')]+/i.exec(text);
    if (!match) return null;
    const raw = match[0].replace(/[.,;:]+$/, '');
    try {
        const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        if (url.protocol === 'http:') url.protocol = 'https:';
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

export function keyGuideFor(manifest: CapabilityManifest): KeyGuide | null {
    if (manifest.auth.kind === 'none' || manifest.auth.kind === 'oauth') return null;
    const curated = curatedFor(manifest);
    if (curated?.keyGuide) return { ...curated.keyGuide, source: 'provider' };
    const url = firstLink(manifest.auth.hint);
    return url ? { url, requires: 'See the provider’s page.', source: 'spec' } : null;
}

/** A warning when a pasted key does not look like the documented format, or null. */
export function checkKeyFormat(guide: KeyGuide | null, key: string): string | null {
    if (!guide?.format || !key.trim()) return null;
    return new RegExp(guide.format.pattern).test(key.trim())
        ? null
        : `This does not look like the documented key format (${guide.format.describe}). You can still save it.`;
}

export type KeyTestResult = { ok: true; message: string } | { ok: false; message: string };

/** Fields some APIs use to refuse a key while answering 200 (Alpha Vantage). */
const NOTICE_FIELDS = ['Error Message', 'Information', 'Note', 'error', 'message'];

/** A notice some APIs send instead of data with a 200 (Alpha Vantage's `Information`), or null. */
export function noticeIn(value: unknown): string | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    // A notice is the whole answer: one or two fields, one of them a known notice field.
    if (Object.keys(record).length > 2) return null;
    for (const field of NOTICE_FIELDS) {
        if (typeof record[field] === 'string' && record[field]) return record[field] as string;
    }
    return null;
}

/**
 * Run the guide's cheap read with the key in the session slot. The operation
 * must be installed: `installed` maps operationId to the installed
 * capability id for this API.
 */
export async function testKey(
    guide: KeyGuide,
    installed: (operationId: string) => string | undefined
): Promise<KeyTestResult> {
    if (!guide.test) return { ok: false, message: 'This API has no test call.' };
    const id = installed(guide.test.operationId);
    if (!id) return { ok: false, message: 'Install the operation the test uses first.' };
    const result = await executeCapability(id, guide.test.input);
    if (!result.ok || result.error) return { ok: false, message: `The API refused the test call: ${result.error?.message ?? 'no answer'}` };
    const notice = noticeIn(result.typed?.value);
    if (notice) return { ok: false, message: `The API answered with a notice instead of data: ${notice.slice(0, 200)}` };
    if (guide.test.provesKey === false) {
        return { ok: true, message: 'The API answered. It accepts any key on this call, so this does not prove the key is yours.' };
    }
    return { ok: true, message: 'The key works: the API answered the test call.' };
}


