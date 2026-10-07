// ============================================
// PROJECT OMNI: BUILD THE API INDEX
//
//     npm run catalog:build
//
// Downloads the APIs.guru directory list (CC0-1.0), slims it with
// buildApiIndexEntries, and writes public/api-index.json for the registry
// provider to search. Run it by hand to refresh the snapshot; the output is
// committed so a build never depends on the upstream being reachable, and a
// diff of the file is the review of what changed upstream.
//
// The download is bounded (size and time). Entries the builder cannot use are
// printed, not hidden.
// ============================================

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildApiIndexEntries, CATALOG_SOURCE_URL, type ApiIndex } from '../src/core/capabilities/apiIndex';

/** The list is ~8.8 MB today. Refuse a response far outside that rather than buffer it. */
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const DEADLINE_MS = 60_000;
const OUTPUT = path.join(process.cwd(), 'public', 'api-index.json');

async function readBounded(response: Response): Promise<string> {
    if (!response.body) throw new Error('empty response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_LIST_BYTES) {
            await reader.cancel();
            throw new Error(`list exceeds ${MAX_LIST_BYTES} bytes`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
    const response = await fetch(CATALOG_SOURCE_URL, {
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DEADLINE_MS)
    });
    if (!response.ok) throw new Error(`upstream returned ${response.status}`);

    const { entries, issues } = buildApiIndexEntries(JSON.parse(await readBounded(response)));
    if (entries.length === 0) throw new Error('no usable entries; refusing to overwrite the index');

    const index: ApiIndex = {
        format: 'omni-api-index',
        version: 1,
        source: {
            url: CATALOG_SOURCE_URL,
            license: 'CC0-1.0',
            etag: response.headers.get('etag'),
            lastModified: response.headers.get('last-modified')
        },
        builtAt: new Date().toISOString(),
        entries
    };
    await writeFile(OUTPUT, `${JSON.stringify(index)}\n`, 'utf8');

    const supported = entries.filter(e => e.supported).length;
    const newest = entries.map(e => e.updated).filter(Boolean).sort().at(-1) ?? 'unknown';
    console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}: ${entries.length} APIs, ${supported} OpenAPI 3.x (installable), ${entries.length - supported} Swagger 2.0 (listed, not installable).`);
    console.log(`Upstream last modified ${index.source.lastModified ?? 'unknown'}; newest spec update ${newest}.`);
    if (issues.length > 0) {
        console.log(`Left out ${issues.length} entr${issues.length === 1 ? 'y' : 'ies'}:`);
        for (const issue of issues) console.log(`  ${issue.id}: ${issue.reason}`);
    }
}

main().catch((err: unknown) => {
    console.error('catalog:build failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
