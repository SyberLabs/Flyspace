// ============================================
// PROJECT OMNI: CLIENT BUNDLE SECRET SCAN
//
// The security property this whole codebase is arranged around is that a
// provider key is read from process.env on the SERVER and never reaches the
// browser. That property was asserted by hand — a grep over `.next/static`
// after a build — which means it held only on the days someone remembered.
//
// This is the same check, mechanised. CI builds with a unique CANARY value
// for every secret env var and then looks for those canaries in the client
// bundle. A canary in `dist/client` means a real key would have been there
// too: someone inlined a secret into a client component, imported a server
// module from one, or added a `define` that bakes an env value in.
//
// Scanning for canaries rather than for variable NAMES matters: a name proves
// nothing (the string "ANTHROPIC_API_KEY" appears harmlessly in server code),
// and CI has no real keys to scan for.
//
// Scope is `dist/client` only, deliberately: it is the `assets.directory`
// in `wrangler.jsonc`, so it is exactly what a browser is served. The Worker
// bundle under `dist/server` runs on the server and may legitimately name the
// variables; a value in it would be a different defect (a build-time env
// baked into a Worker), not a browser leak.
// ============================================

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface SecretLeak {
    /** The env var whose value was found. */
    envVar: string;
    /** Path of the served file, relative to the scanned root. */
    file: string;
}

export interface BundleScanResult {
    filesScanned: number;
    bytesScanned: number;
    leaks: SecretLeak[];
}

export interface Canary {
    envVar: string;
    value: string;
}

/** Every file under `root`, depth first. Symlinks are not followed. */
function walk(root: string, rel = ''): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const next = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
            out.push(...walk(root, next));
        } else if (entry.isFile()) {
            out.push(next);
        }
        // Symlinks are skipped: a served bundle has none, and following them
        // would let the scan wander outside the directory it was given.
    }
    return out;
}

/**
 * Search every file under `root` for each canary value.
 *
 * Compares against raw bytes rather than decoded text, so the result does not
 * depend on guessing an encoding and source maps, fonts and images are all
 * covered by the same pass.
 */
export function scanDirectoryForSecrets(root: string, canaries: Canary[]): BundleScanResult {
    const usable = canaries.filter(c => c.value.length >= MIN_CANARY_LENGTH);
    const leaks: SecretLeak[] = [];
    let bytesScanned = 0;

    const files = walk(root);
    for (const file of files) {
        const full = path.join(root, file);
        bytesScanned += statSync(full).size;
        const bytes = readFileSync(full);
        for (const canary of usable) {
            if (bytes.includes(canary.value)) {
                leaks.push({ envVar: canary.envVar, file });
            }
        }
    }

    return { filesScanned: files.length, bytesScanned, leaks };
}

/**
 * Shorter than this and a canary would collide with ordinary bundle text,
 * turning the gate into a source of false alarms nobody trusts.
 */
export const MIN_CANARY_LENGTH = 12;

/**
 * A distinctive, greppable value for one env var. Deterministic per name plus
 * `salt` so a failure message can be traced back to the run that produced it.
 */
export function canaryFor(envVar: string, salt: string): string {
    return `OMNI-CANARY-${envVar}-${salt}`;
}

/**
 * A scan that found nothing because it was pointed at an empty or missing
 * directory is worse than no scan: it reports success and means nothing.
 * Callers use this to tell "clean" apart from "vacuous".
 */
export function isVacuous(result: BundleScanResult): boolean {
    return result.filesScanned === 0 || result.bytesScanned === 0;
}
