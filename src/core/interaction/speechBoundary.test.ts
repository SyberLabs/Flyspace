import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'src');
// Assembled so this file does not match itself.
const RECOGNIZER = new RegExp(`\\b(?:webkit)?Speech${'Recognition'}\\b`);

const ADAPTER = 'src/core/interaction/browserSpeechAdapter.ts';

/**
 * The Listen content capability predates the control seam and lives under
 * src/core/capabilities, which the speech work packages must not edit.
 * It is canvas content, not the control path; the control path may not import it.
 */
const EXEMPT: Record<string, string> = {
    'src/core/capabilities/speech.ts': 'Listen content capability; not the speech control path'
};

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
        else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
}

function rel(file: string): string {
    return path.relative(ROOT, file).split(path.sep).join('/');
}

describe('speech control boundary', () => {
    const files = sourceFiles(SRC);

    it('only the browser adapter names the Web Speech recognizer', () => {
        const offenders = files
            .filter(file => RECOGNIZER.test(readFileSync(file, 'utf8')))
            .map(rel)
            .filter(file => file !== ADAPTER && !(file in EXEMPT));
        expect(offenders).toEqual([]);
    });

    it('the adapter and every exemption still exist and still need to', () => {
        expect(RECOGNIZER.test(readFileSync(path.join(ROOT, ADAPTER), 'utf8'))).toBe(true);
        for (const file of Object.keys(EXEMPT)) {
            expect(RECOGNIZER.test(readFileSync(path.join(ROOT, file), 'utf8'))).toBe(true);
        }
    });

    it('the control path does not import the Listen capability, capability install, or the registry', () => {
        const control = files.filter(file => {
            const name = rel(file);
            return name.startsWith('src/core/interaction/') || name.startsWith('src/components/voice/');
        });
        const offenders = control.filter(file => /from ['"](?:@\/core\/capabilities|\.\.\/capabilities)/.test(readFileSync(file, 'utf8')));
        expect(offenders.map(rel)).toEqual([]);
    });
});
