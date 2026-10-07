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
//
// Then every OpenAPI 3.x spec is fetched and compiled, so search can tell an
// API that gives you something to place from one that compiles to nothing.
// A spec whose URL and update date match the previous index keeps its count
// without a download. `--no-compile` skips this step.
// ============================================

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    buildApiIndexEntries,
    CATALOG_SOURCE_URL,
    describeCompileBlocker,
    parseApiIndex,
    type ApiIndex,
    type ApiIndexEntry
} from '../src/core/capabilities/apiIndex';
import { compileOpenApi } from '../src/core/capabilities/openapi';

/** The list is ~8.8 MB today. Refuse a response far outside that rather than buffer it. */
const MAX_LIST_BYTES = 64 * 1024 * 1024;
const DEADLINE_MS = 60_000;
const OUTPUT = path.join(process.cwd(), 'public', 'api-index.json');
/** One spec. The largest in the directory are tens of MB; past this, skip it. */
const MAX_SPEC_BYTES = 32 * 1024 * 1024;
const SPEC_DEADLINE_MS = 30_000;
const CONCURRENCY = 8;

async function readBounded(response: Response, max = MAX_LIST_BYTES): Promise<string> {
    if (!response.body) throw new Error('empty response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel();
            throw new Error(`response exceeds ${max} bytes`);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
}

const CAPABILITIES_DIR = path.join(process.cwd(), 'src', 'core', 'capabilities');

/** A hash of the compiler's source (every non-test module it can import), so a change to it recounts. */
async function compilerFingerprint(): Promise<string> {
    const files = (await readdir(CAPABILITIES_DIR)).filter(name => name.endsWith('.ts') && !name.includes('.test.') && !name.includes('.eval.')).sort();
    const hash = createHash('sha256');
    for (const name of files) hash.update(name).update('\0').update(await readFile(path.join(CAPABILITIES_DIR, name)));
    return hash.digest('hex').slice(0, 32);
}

/** The previous index's counts, keyed by id, when the same compiler made them. */
async function previousCounts(compiler: string): Promise<Map<string, ApiIndexEntry>> {
    try {
        const previous = parseApiIndex(JSON.parse(await readFile(OUTPUT, 'utf8')));
        if (!previous || previous.compiler !== compiler) return new Map();
        return new Map(previous.entries.filter(entry => entry.operations !== undefined).map(entry => [entry.id, entry]));
    } catch {
        return new Map();
    }
}

async function compileStatus(entry: ApiIndexEntry): Promise<Pick<ApiIndexEntry, 'operations' | 'blocker'>> {
    const response = await fetch(entry.specUrl, {
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(SPEC_DEADLINE_MS)
    });
    if (!response.ok) throw new Error(`spec returned ${response.status}`);
    const { manifests, errors } = compileOpenApi(JSON.parse(await readBounded(response, MAX_SPEC_BYTES)), { sourceLocator: entry.specUrl });
    if (manifests.length > 0) return { operations: manifests.length };
    return { operations: 0, blocker: describeCompileBlocker(errors.map(error => error.message)) };
}

/** Fill in `operations` for every OpenAPI 3.x entry. A spec that cannot be fetched stays unknown. */
async function addCompileStatus(entries: ApiIndexEntry[], compiler: string): Promise<{ checked: number; reused: number; failed: string[] }> {
    const previous = await previousCounts(compiler);
    const todo: ApiIndexEntry[] = [];
    let reused = 0;
    for (const entry of entries) {
        if (!entry.supported) continue;
        const before = previous.get(entry.id);
        if (before && before.specUrl === entry.specUrl && before.updated === entry.updated && entry.updated !== '') {
            entry.operations = before.operations;
            if (before.blocker !== undefined) entry.blocker = before.blocker;
            reused += 1;
        } else {
            todo.push(entry);
        }
    }

    const failed: string[] = [];
    let next = 0;
    let done = 0;
    const worker = async () => {
        while (next < todo.length) {
            const entry = todo[next++];
            try {
                Object.assign(entry, await compileStatus(entry));
            } catch (err) {
                failed.push(`${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
            done += 1;
            if (done % 100 === 0) console.log(`  compiled ${done}/${todo.length}`);
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return { checked: todo.length, reused, failed };
}

async function main(): Promise<void> {
    const compile = !process.argv.includes('--no-compile');
    const response = await fetch(CATALOG_SOURCE_URL, {
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DEADLINE_MS)
    });
    if (!response.ok) throw new Error(`upstream returned ${response.status}`);

    const { entries, issues } = buildApiIndexEntries(JSON.parse(await readBounded(response)));
    if (entries.length === 0) throw new Error('no usable entries; refusing to overwrite the index');
    const compiler = compile ? await compilerFingerprint() : undefined;
    const status = compiler ? await addCompileStatus(entries, compiler) : null;

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
        ...(compiler ? { compiler } : {}),
        entries
    };
    await writeFile(OUTPUT, `${JSON.stringify(index)}\n`, 'utf8');

    const supported = entries.filter(e => e.supported).length;
    const newest = entries.map(e => e.updated).filter(Boolean).sort().at(-1) ?? 'unknown';
    console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)}: ${entries.length} APIs, ${supported} OpenAPI 3.x (installable), ${entries.length - supported} Swagger 2.0 (listed, not installable).`);
    console.log(`Upstream last modified ${index.source.lastModified ?? 'unknown'}; newest spec update ${newest}.`);
    if (status) {
        const counted = entries.filter(e => e.operations !== undefined);
        const empty = counted.filter(e => e.operations === 0).length;
        console.log(`Compiled ${status.checked} specs (${status.reused} unchanged, reused): ${counted.length - empty} give at least one operation, ${empty} give none.`);
        if (status.failed.length > 0) {
            console.log(`Could not check ${status.failed.length} (left unknown):`);
            for (const failure of status.failed) console.log(`  ${failure}`);
        }
    }
    if (issues.length > 0) {
        console.log(`Left out ${issues.length} entr${issues.length === 1 ? 'y' : 'ies'}:`);
        for (const issue of issues) console.log(`  ${issue.id}: ${issue.reason}`);
    }
}

main().catch((err: unknown) => {
    console.error('catalog:build failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
