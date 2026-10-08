// ============================================
// PROJECT OMNI: CLIENT BUNDLE SECRET SCAN (CLI)
//
//     npm run scan:bundle
//
// Two modes, both of which end in the same scan of `dist/client`, the asset
// directory `wrangler.jsonc` serves: the vinext build is the one artefact that
// deploys, so it is the one the scan has to prove clean.
//
//   --canaries   Print `KEY=value` lines for every secret env var. CI evals
//                these into the build environment, so the build runs with a
//                distinctive fake value standing in for each real key.
//
//   (default)    Scan the built client bundle for those same values and exit
//                non-zero if any of them is there.
//
// Locally, `npm run scan:bundle` after any build checks whatever secrets are
// actually in your .env — which is the same property, proven against real
// values instead of canaries.
//
// Exit codes: 0 clean, 1 leak found, 2 the scan could not prove anything.
// ============================================

import { existsSync } from 'node:fs';
import path from 'node:path';
import {
    scanDirectoryForSecrets,
    canaryFor,
    isVacuous,
    MIN_CANARY_LENGTH,
    type Canary
} from '../src/core/bundleScan';
import { SECRET_ENV_VARS } from '../src/core/secrets';

/** What a browser is actually served. See bundleScan.ts on why only this. */
const CLIENT_BUNDLE_DIR = path.join(process.cwd(), 'dist', 'client');

function printCanaries(): void {
    // A per-invocation salt: a scan can only ever pass against the bundle the
    // same run built, never against a stale dist/ left over from before.
    const salt = process.env.OMNI_CANARY_SALT?.trim() || String(Date.now());
    for (const name of SECRET_ENV_VARS) {
        process.stdout.write(`${name}=${canaryFor(name, salt)}\n`);
    }
}

function collectCanaries(): Canary[] {
    const out: Canary[] = [];
    const skipped: string[] = [];
    for (const envVar of SECRET_ENV_VARS) {
        const value = process.env[envVar]?.trim();
        if (!value) {
            skipped.push(envVar);
            continue;
        }
        if (value.length < MIN_CANARY_LENGTH) {
            skipped.push(`${envVar} (too short to search for)`);
            continue;
        }
        out.push({ envVar, value });
    }
    if (skipped.length > 0) {
        console.log(`  not set, nothing to look for: ${skipped.join(', ')}`);
    }
    return out;
}

function main(): void {
    if (process.argv.includes('--canaries')) {
        printCanaries();
        return;
    }

    console.log(`Scanning ${path.relative(process.cwd(), CLIENT_BUNDLE_DIR)} for secret values...`);

    if (!existsSync(CLIENT_BUNDLE_DIR)) {
        console.error(
            `\nNo client bundle at ${CLIENT_BUNDLE_DIR}.\n` +
            'Run `npm run build` first - a scan with nothing to scan proves nothing.'
        );
        process.exit(2);
    }

    const canaries = collectCanaries();
    if (canaries.length === 0) {
        console.error(
            '\nNone of the secret env vars are set, so this scan could not have\n' +
            'failed. Set them (or use --canaries in CI) before trusting the result.'
        );
        process.exit(2);
    }

    const result = scanDirectoryForSecrets(CLIENT_BUNDLE_DIR, canaries);

    if (isVacuous(result)) {
        console.error(
            `\nScanned ${result.filesScanned} file(s), ${result.bytesScanned} bytes.\n` +
            'That is not a real bundle. Refusing to report a pass.'
        );
        process.exit(2);
    }

    if (result.leaks.length > 0) {
        console.error(
            `\nFAIL — ${result.leaks.length} secret value(s) reached the client bundle:\n`
        );
        for (const leak of result.leaks) {
            console.error(`  ${leak.envVar}  ->  ${leak.file}`);
        }
        console.error(
            '\nA value here is served to every visitor. Likely causes: an env var\n' +
            'renamed to NEXT_PUBLIC_*, a secret read inside a client component, or\n' +
            'a server-only module imported from one.\n'
        );
        process.exit(1);
    }

    console.log(
        `PASS — ${canaries.length} secret(s) checked against ` +
        `${result.filesScanned} file(s) (${(result.bytesScanned / 1024).toFixed(0)} KiB). ` +
        'None reached the client bundle.'
    );
}

main();
