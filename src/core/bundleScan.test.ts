// ============================================
// CLIENT BUNDLE SECRET SCAN
//
// The gate exists to fail when a key reaches the browser, so the tests that
// matter are the ones proving it CAN fail — a scanner that always passes is
// indistinguishable from no scanner at all, and much more reassuring than it
// deserves to be.
// ============================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    scanDirectoryForSecrets,
    canaryFor,
    isVacuous,
    MIN_CANARY_LENGTH,
    type Canary
} from './bundleScan';
import { SECRET_ENV_VARS } from './secrets';

let root: string;

beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'omni-bundle-scan-'));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

function write(rel: string, contents: string): void {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, contents);
}

const KEY: Canary = { envVar: 'ANTHROPIC_API_KEY', value: canaryFor('ANTHROPIC_API_KEY', 'abc123') };

describe('catching a leak', () => {
    it('finds a secret inlined into a chunk', () => {
        write('chunks/main.js', `const k="${KEY.value}";fetch(u,{headers:{k}})`);
        const result = scanDirectoryForSecrets(root, [KEY]);

        expect(result.leaks).toEqual([
            { envVar: 'ANTHROPIC_API_KEY', file: path.join('chunks', 'main.js') }
        ]);
    });

    it('finds it however deeply nested', () => {
        write('chunks/app/(routes)/deep/page-1a2b.js', `x=${JSON.stringify(KEY.value)}`);
        expect(scanDirectoryForSecrets(root, [KEY]).leaks).toHaveLength(1);
    });

    it('finds it in a source map, not just the code', () => {
        write('chunks/main.js', 'clean');
        write('chunks/main.js.map', `{"sourcesContent":["const k='${KEY.value}'"]}`);

        const leaks = scanDirectoryForSecrets(root, [KEY]).leaks;
        expect(leaks).toHaveLength(1);
        expect(leaks[0].file).toContain('.map');
    });

    it('finds it in a non-text file, since the scan reads bytes', () => {
        // A key baked into a binary asset is still a key that shipped.
        write('media/logo.woff2', `\u0000\u0001${KEY.value}\u0000`);
        expect(scanDirectoryForSecrets(root, [KEY]).leaks).toHaveLength(1);
    });

    it('reports every offending file, not just the first', () => {
        write('chunks/a.js', KEY.value);
        write('chunks/b.js', KEY.value);
        expect(scanDirectoryForSecrets(root, [KEY]).leaks).toHaveLength(2);
    });

    it('reports each leaked variable separately', () => {
        const other: Canary = { envVar: 'DATABASE_URL', value: canaryFor('DATABASE_URL', 'abc123') };
        write('chunks/a.js', `${KEY.value} and ${other.value}`);

        const names = scanDirectoryForSecrets(root, [KEY, other]).leaks.map(l => l.envVar).sort();
        expect(names).toEqual(['ANTHROPIC_API_KEY', 'DATABASE_URL']);
    });
});

describe('not crying wolf', () => {
    it('passes a bundle that merely names the variable', () => {
        // Server code legitimately contains the NAME. Only the VALUE matters.
        write('chunks/main.js', 'if(process.env.ANTHROPIC_API_KEY){}');
        expect(scanDirectoryForSecrets(root, [KEY]).leaks).toEqual([]);
    });

    it('passes a bundle with a similar-looking but different value', () => {
        write('chunks/main.js', canaryFor('ANTHROPIC_API_KEY', 'different'));
        expect(scanDirectoryForSecrets(root, [KEY]).leaks).toEqual([]);
    });

    it('ignores a canary too short to be distinctive', () => {
        // Otherwise an unset or trivial env value would match half the bundle.
        write('chunks/main.js', 'const mode="dev";');
        const tiny: Canary = { envVar: 'X', value: 'dev' };
        expect(tiny.value.length).toBeLessThan(MIN_CANARY_LENGTH);
        expect(scanDirectoryForSecrets(root, [tiny]).leaks).toEqual([]);
    });

    it('scans a clean bundle to completion and reports what it covered', () => {
        write('chunks/main.js', 'export const x=1');
        write('css/app.css', 'body{margin:0}');

        const result = scanDirectoryForSecrets(root, [KEY]);
        expect(result.leaks).toEqual([]);
        expect(result.filesScanned).toBe(2);
        expect(result.bytesScanned).toBeGreaterThan(0);
    });
});

describe('a scan that proves nothing', () => {
    it('flags an empty directory as vacuous rather than clean', () => {
        const result = scanDirectoryForSecrets(root, [KEY]);
        expect(result.leaks).toEqual([]);
        expect(isVacuous(result)).toBe(true);
    });

    it('flags a directory of empty files as vacuous', () => {
        write('chunks/main.js', '');
        expect(isVacuous(scanDirectoryForSecrets(root, [KEY]))).toBe(true);
    });

    it('does not flag a real bundle as vacuous', () => {
        write('chunks/main.js', 'export const x=1');
        expect(isVacuous(scanDirectoryForSecrets(root, [KEY]))).toBe(false);
    });

    it('does not follow a symlink out of the scanned tree', () => {
        const outside = mkdtempSync(path.join(tmpdir(), 'omni-outside-'));
        try {
            writeFileSync(path.join(outside, 'secrets.env'), KEY.value);
            write('chunks/main.js', 'clean');
            try {
                symlinkSync(outside, path.join(root, 'escape'), 'dir');
            } catch {
                return; // Windows without developer mode: nothing to prove here.
            }

            const result = scanDirectoryForSecrets(root, [KEY]);
            expect(result.leaks).toEqual([]);
            expect(result.filesScanned).toBe(1);
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });
});

describe('canary values', () => {
    it('are long enough to be distinctive for every secret we scan for', () => {
        for (const name of SECRET_ENV_VARS) {
            expect(canaryFor(name, 'ci').length).toBeGreaterThanOrEqual(MIN_CANARY_LENGTH);
        }
    });

    it('differ per variable, so a failure names the right one', () => {
        const all = SECRET_ENV_VARS.map(n => canaryFor(n, 'ci'));
        expect(new Set(all).size).toBe(all.length);
    });

    it('differ per run, so a stale artifact cannot pass a fresh scan', () => {
        expect(canaryFor('ANTHROPIC_API_KEY', 'run-1'))
            .not.toBe(canaryFor('ANTHROPIC_API_KEY', 'run-2'));
    });
});

describe('the secret list itself', () => {
    it('covers every provider key the app reads', () => {
        // Kept in step with .env.example by hand; this is the reminder.
        expect(SECRET_ENV_VARS).toContain('ANTHROPIC_API_KEY');
        expect(SECRET_ENV_VARS).toContain('GOOGLE_API_KEY');
        expect(SECRET_ENV_VARS).toContain('NEWSAPI_KEY');
        expect(SECRET_ENV_VARS).toContain('FRED_API_KEY');
        expect(SECRET_ENV_VARS).toContain('BLS_API_KEY');
        expect(SECRET_ENV_VARS).toContain('ALPHA_VANTAGE_API_KEY');
        expect(SECRET_ENV_VARS).toContain('METACULUS_API_KEY');
    });

    it('covers both connection strings', () => {
        expect(SECRET_ENV_VARS).toContain('DATABASE_URL');
        expect(SECRET_ENV_VARS).toContain('OMNI_TEST_DATABASE_URL');
    });

    it('never claims a NEXT_PUBLIC_ var is secret', () => {
        // Next inlines those into the client bundle on purpose. Listing one
        // here would make the gate fail on correct code, every time.
        for (const name of SECRET_ENV_VARS) {
            expect(name.startsWith('NEXT_PUBLIC_')).toBe(false);
        }
    });
});
