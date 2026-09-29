// eslint-plugin-react 7.37.5 calls context.getFilename(), which ESLint 10 removed.
// The published plugin has no ESLint 10 release yet. This restores the fallback
// that already exists on the plugin's main branch: context.filename.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const TARGETS = [
    {
        suffix: path.join('eslint-plugin-react', 'lib', 'util', 'version.js'),
        from: 'contextOrFilename.getFilename()',
        to: '(contextOrFilename.getFilename ? contextOrFilename.getFilename() : contextOrFilename.filename)'
    },
    {
        suffix: path.join('eslint-plugin-react', 'lib', 'rules', 'jsx-filename-extension.js'),
        from: 'context.getFilename()',
        to: '(context.getFilename ? context.getFilename() : context.filename)'
    }
];

function walk(dir, found) {
    let entries;
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        if (entry === '.bin') continue;
        const full = path.join(dir, entry);
        let info;
        try {
            info = statSync(full);
        } catch {
            continue;
        }
        if (!info.isDirectory()) continue;
        if (entry === 'eslint-plugin-react') found.push(full);
        else walk(full, found);
    }
}

const roots = [];
walk(path.join(process.cwd(), 'node_modules'), roots);
if (roots.length === 0) {
    console.error('eslint-plugin-react was not installed; refusing to leave ESLint 10 unpatched');
    process.exit(1);
}

for (const root of roots) {
    for (const target of TARGETS) {
        const file = path.join(root, path.relative(path.join('eslint-plugin-react'), target.suffix));
        const source = readFileSync(file, 'utf8');
        if (source.includes(target.to)) continue;
        if (!source.includes(target.from)) {
            console.error(`Expected ${target.from} in ${file}`);
            process.exit(1);
        }
        writeFileSync(file, source.replace(target.from, target.to));
    }
}
