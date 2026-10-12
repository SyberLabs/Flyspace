// ============================================
// FLYSPACE: LINE METRICS
//
//     npm run metrics:line                       # catalog coverage
//     npm run metrics:line -- --url http://127.0.0.1:3000 [--runs 3]
//
// The baseline APEX_PLAN.md section 6 steers by. Catalog coverage is read
// from public/api-index.json and the curated list: how many APIs give
// something to place, and how many of those need no credential. With --url,
// a fresh browser (no stored canvas) opens the app, takes the World Watch
// kit, and records the time to the first block showing live data and how
// many of the kit's data blocks reach live data on the first try.
// Nothing here writes to the repo; paste the output into a PR as the
// measurement.
// ============================================

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseApiIndex, type ApiIndexEntry } from '../src/core/capabilities/apiIndex';
import { CURATED_APIS } from '../src/core/capabilities/curatedApis';
import { SHELL_TEMPLATES } from '../src/core/shells/templates';

/** The kit timed for "first live data"; every kit is checked for blocks live on the first try. */
const TIMED_KIT = 'World Watch';
/** How long a kit's blocks get to reach live data before they count as not running. */
const SETTLE_MS = 20_000;

function arg(name: string): string | undefined {
    const at = process.argv.indexOf(`--${name}`);
    return at >= 0 ? process.argv[at + 1] : undefined;
}

function pct(part: number, whole: number): string {
    return whole === 0 ? '0%' : `${Math.round((100 * part) / whole)}%`;
}

function catalog(): void {
    const index = parseApiIndex(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'api-index.json'), 'utf8')));
    if (!index) throw new Error('public/api-index.json does not parse');
    const directory = index.entries.filter(e => e.supported);
    const usable = directory.filter(e => (e.operations ?? 0) > 0);
    const by = (entries: ApiIndexEntry[], need: string) => entries.filter(e => e.credential === need).length;
    const unknown = usable.filter(e => e.credential === undefined).length;
    const curated = CURATED_APIS.map(api => api.entry);

    console.log('## Catalog coverage');
    console.log(`Index built ${index.builtAt}; ${directory.length} OpenAPI 3.x directory entries.`);
    console.log('');
    console.log('| | APIs | share of usable |');
    console.log('| --- | --- | --- |');
    console.log(`| usable (compiles to at least one operation) | ${usable.length} | 100% |`);
    console.log(`| no credential | ${by(usable, 'none')} | ${pct(by(usable, 'none'), usable.length)} |`);
    console.log(`| some operations need one | ${by(usable, 'partial')} | ${pct(by(usable, 'partial'), usable.length)} |`);
    console.log(`| every operation needs a key, token or login | ${by(usable, 'key')} | ${pct(by(usable, 'key'), usable.length)} |`);
    if (unknown > 0) console.log(`| not recorded (index predates credential needs) | ${unknown} | ${pct(unknown, usable.length)} |`);
    console.log(`| curated by Flyspace | ${curated.length} (${by(curated, 'none')} keyless) | |`);
    console.log(`| verified by the quality line | 0 | not built yet (APEX_PLAN 6.4) |`);
}

/** Open a fresh browser, take a kit, and return how long first live data took and each data block's status. */
async function takeKit(browser: import('@playwright/test').Browser, url: string, kit: string): Promise<{ firstLive: number | null; statuses: string[] }> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    try {
        const started = Date.now();
        await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
        await page.getByTitle('Shell Manager').click();
        await page.locator('.group').filter({ hasText: kit }).getByRole('button', { name: 'Use this shell' }).click();
        const tookShell = Date.now();
        let firstLive: number | null = null;
        try {
            await page.locator('.block-card[data-status="connected"]').first().waitFor({ timeout: SETTLE_MS });
            firstLive = Date.now() - started;
        } catch { /* nothing came live */ }
        await page.waitForTimeout(Math.max(0, SETTLE_MS - (Date.now() - tookShell)));
        // Persona and memory blocks wait for a question; only data blocks are expected to run.
        const statuses = await page.locator('.block-card').evaluateAll(cards => cards
            .filter(card => !/^(persona_|memory_)/.test(card.getAttribute('data-block-type') ?? ''))
            .map(card => `${card.getAttribute('data-block-type')}:${card.getAttribute('data-status') ?? 'unknown'}`));
        return { firstLive, statuses };
    } finally {
        await context.close();
    }
}

async function kits(url: string): Promise<void> {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    console.log('## Kits: data blocks live on the first try');
    console.log('');
    console.log('| Kit | Live | Not live |');
    console.log('| --- | --- | --- |');
    try {
        for (const template of SHELL_TEMPLATES) {
            const { statuses } = await takeKit(browser, url, template.name);
            const live = statuses.filter(s => s.endsWith(':connected'));
            const notLive = statuses.filter(s => !s.endsWith(':connected'));
            console.log(`| ${template.name} | ${live.length}/${statuses.length} | ${notLive.join(', ') || 'none'} |`);
        }
    } finally {
        await browser.close();
    }
}

async function firstRun(url: string, runs: number): Promise<void> {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const times: number[] = [];
    const firstTry: string[] = [];
    try {
        for (let run = 1; run <= runs; run++) {
            const { firstLive, statuses } = await takeKit(browser, url, TIMED_KIT);
            if (firstLive !== null) times.push(firstLive);
            const live = statuses.filter(s => s.endsWith(':connected')).length;
            firstTry.push(`${live}/${statuses.length}`);
            console.log(`run ${run}: first live data ${firstLive ?? 'never'} ms; data blocks live after ${SETTLE_MS / 1000}s: ${live}/${statuses.length} (${statuses.join(', ')})`);
        }
    } finally {
        await browser.close();
    }
    const sorted = [...times].sort((a, b) => a - b);
    console.log('');
    console.log('## First run');
    console.log(`Fresh browser, ${TIMED_KIT} kit, ${runs} run(s) against ${url}.`);
    console.log(`Time to first live data: median ${sorted[Math.floor(sorted.length / 2)]} ms (runs: ${times.join(', ')} ms).`);
    console.log(`Data blocks live on the first try: ${firstTry.join(', ')}.`);
}

async function main(): Promise<void> {
    catalog();
    const url = arg('url');
    if (url) {
        console.log('');
        await firstRun(url, Number(arg('runs') ?? 3));
        console.log('');
        await kits(url);
    }
}

main().catch((err: unknown) => {
    console.error('metrics:line failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
