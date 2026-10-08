// ============================================
// API INDEX: the catalog the registry provider searches.
//
// A slimmed, dated snapshot of the APIs.guru OpenAPI directory (CC0-1.0),
// built by `npm run catalog:build` and served as a static asset, so search
// never downloads the 8.8 MB upstream list. The index is the trust anchor for
// where a spec may be fetched from: every entry's spec URL must be on
// CATALOG_SPEC_HOST, checked when the index is built and again when it loads.
//
// Staleness is part of the data, not a footnote. Each entry carries the date
// its spec last changed upstream, and the index records where and when it was
// built, so the UI can say how old "the right JSON" actually is.
// ============================================

/** The one host specs are fetched from. Every upstream spec URL is on it today. */
export const CATALOG_SPEC_HOST = 'api.apis.guru';

/** Upstream list this index is built from. */
export const CATALOG_SOURCE_URL = 'https://api.apis.guru/v2/list.json';

/** Long descriptions are cut here: the index ships to the browser. */
export const MAX_DESCRIPTION_CHARS = 280;

const MAX_TITLE_CHARS = 120;
const MAX_CATEGORIES = 8;

export interface ApiIndexEntry {
    /** APIs.guru id, e.g. `1password.com:events`. Unique within the index. */
    id: string;
    title: string;
    description: string;
    categories: string[];
    /** The preferred version's spec, always https on CATALOG_SPEC_HOST. */
    specUrl: string;
    /** As the directory reports it, e.g. `3.0.0` or `2.0`. */
    openapiVersion: string;
    /** The compiler accepts OpenAPI 3.x only; 2.0 entries are listed but not installable. */
    supported: boolean;
    /** `YYYY-MM-DD` the spec last changed upstream, or '' when the directory does not say. */
    updated: string;
    /**
     * How many operations the compiler made from the spec when the index was
     * built, up to its cap of MAX_INDEXED_OPERATIONS. Absent when not checked
     * (Swagger 2.0, or the spec could not be fetched at build time).
     */
    operations?: number;
    /** Why nothing compiled, in plain words. Only when `operations` is 0. */
    blocker?: string;
    /**
     * Shipped with OmniOS (curatedApis.ts), not from the directory. Never
     * present in the built index: parseApiIndex refuses it there.
     */
    curated?: true;
}

/** The compiler stops after this many operations, so the index counts no higher. */
export const MAX_INDEXED_OPERATIONS = 100;
const MAX_BLOCKER_CHARS = 160;

/** Whether choosing this entry can give you anything to place. Unknown counts as yes. */
export function isUsableEntry(entry: ApiIndexEntry): boolean {
    return entry.supported && entry.operations !== 0;
}

/**
 * The reason most operations of a spec did not compile, said so a person can
 * tell what is missing. The compiler's own words are kept for the rest.
 */
export function describeCompileBlocker(messages: readonly string[]): string {
    if (messages.length === 0) return 'No operations it describes can be used yet';
    const reasons = messages.map(message => {
        if (/must be signed/i.test(message)) {
            return 'Every request must be signed (as with AWS), which OmniOS does not do';
        }
        if (/combine several schemes|no supported security scheme|unsupported scheme|oauth/i.test(message)) {
            return 'It needs a sign-in OmniOS does not support yet (OAuth, or several keys at once)';
        }
        if (/baseUrl must be https|server url|relative server|concrete server/i.test(message)) {
            return 'Its server address is not a fixed https URL';
        }
        if (/compound .* parameters|parameter style|cookie parameters/i.test(message)) {
            return 'It takes parameters in a form OmniOS does not support yet';
        }
        if (/oneOf|anyOf|allOf|cyclic|does not declare a type|not a single ValueType/i.test(message)) {
            return 'Its data shapes are ones OmniOS cannot type yet';
        }
        if (/responses are in the supported subset|response schema is required|no success response|requestBody must be application/i.test(message)) {
            return 'It does not send and receive plain JSON';
        }
        if (/only OpenAPI 3/i.test(message)) return 'Only OpenAPI 3.x can be installed';
        return oneLine(message.replace(/^[^:]{1,80}: /, ''), MAX_BLOCKER_CHARS);
    });
    const counts = new Map<string, number>();
    for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

export interface ApiIndex {
    format: 'omni-api-index';
    version: 1;
    source: {
        url: string;
        license: 'CC0-1.0';
        /** HTTP validators of the upstream list, so a rebuild can tell whether anything changed. */
        etag: string | null;
        lastModified: string | null;
    };
    builtAt: string;
    /**
     * Fingerprint of the compiler source that made the `operations` counts.
     * A rebuild reuses a count only when this matches, so a compiler change
     * recounts everything.
     */
    compiler?: string;
    entries: ApiIndexEntry[];
}

export interface BuildIssue {
    id: string;
    reason: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneLine(value: unknown, max: number): string {
    if (typeof value !== 'string') return '';
    const flat = value.replace(/\s+/g, ' ').trim();
    return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** A spec URL the index may carry: https, on the catalog host, nothing smuggled in. */
export function isCatalogSpecUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        return false;
    }
    return url.protocol === 'https:'
        && url.host === CATALOG_SPEC_HOST
        && !url.username && !url.password
        && !url.search && !url.hash
        && url.pathname.endsWith('.json');
}

/**
 * Slim the upstream list into index entries. Entries that cannot be used are
 * reported, not silently dropped, so a rebuild shows what it left out.
 */
export function buildApiIndexEntries(raw: unknown): { entries: ApiIndexEntry[]; issues: BuildIssue[] } {
    const entries: ApiIndexEntry[] = [];
    const issues: BuildIssue[] = [];
    if (!isRecord(raw)) return { entries, issues: [{ id: '(root)', reason: 'list is not an object' }] };

    for (const [id, api] of Object.entries(raw)) {
        if (!isRecord(api) || !isRecord(api.versions) || typeof api.preferred !== 'string') {
            issues.push({ id, reason: 'no preferred version' });
            continue;
        }
        const version = api.versions[api.preferred];
        if (!isRecord(version)) {
            issues.push({ id, reason: 'preferred version missing' });
            continue;
        }
        if (!isCatalogSpecUrl(version.swaggerUrl)) {
            issues.push({ id, reason: 'spec URL is not an https JSON URL on the catalog host' });
            continue;
        }
        const info = isRecord(version.info) ? version.info : {};
        const openapiVersion = typeof version.openapiVer === 'string' ? version.openapiVer : '';
        const categories = Array.isArray(info['x-apisguru-categories'])
            ? info['x-apisguru-categories'].filter((c): c is string => typeof c === 'string').slice(0, MAX_CATEGORIES)
            : [];
        entries.push({
            id,
            title: oneLine(info.title, MAX_TITLE_CHARS) || id,
            description: oneLine(info.description, MAX_DESCRIPTION_CHARS),
            categories,
            specUrl: version.swaggerUrl,
            openapiVersion,
            supported: openapiVersion.startsWith('3.'),
            updated: typeof version.updated === 'string' ? version.updated.slice(0, 10) : ''
        });
    }

    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { entries, issues };
}

/** `operations` is a count the builder can have made; `blocker` only explains a zero. */
function validCompileStatus(entry: Record<string, unknown>): boolean {
    const { operations, blocker } = entry;
    if (operations === undefined) return blocker === undefined;
    if (entry.supported !== true) return false;
    if (typeof operations !== 'number' || !Number.isInteger(operations) || operations < 0 || operations > MAX_INDEXED_OPERATIONS) return false;
    if (blocker === undefined) return true;
    return operations === 0 && typeof blocker === 'string' && blocker.length <= MAX_BLOCKER_CHARS;
}

/**
 * Validate an index as it arrives in the browser. A static asset is still
 * input: a stale deploy, a proxy or a bad build could serve anything, and an
 * entry's specUrl decides what the browser will fetch.
 */
export function parseApiIndex(value: unknown): ApiIndex | null {
    if (!isRecord(value) || value.format !== 'omni-api-index' || value.version !== 1) return null;
    if (!isRecord(value.source) || !Array.isArray(value.entries)) return null;
    if (value.compiler !== undefined && (typeof value.compiler !== 'string' || !/^[0-9a-f]{16,64}$/.test(value.compiler))) return null;
    const seen = new Set<string>();
    for (const entry of value.entries) {
        if (!isRecord(entry)
            || typeof entry.id !== 'string' || seen.has(entry.id)
            || typeof entry.title !== 'string'
            || typeof entry.description !== 'string'
            || !Array.isArray(entry.categories) || !entry.categories.every(c => typeof c === 'string')
            || !isCatalogSpecUrl(entry.specUrl)
            || typeof entry.openapiVersion !== 'string'
            || typeof entry.supported !== 'boolean'
            || entry.supported !== entry.openapiVersion.startsWith('3.')
            || typeof entry.updated !== 'string'
            || !validCompileStatus(entry)
            || entry.curated !== undefined) {
            return null;
        }
        seen.add(entry.id);
    }
    return value as unknown as ApiIndex;
}
