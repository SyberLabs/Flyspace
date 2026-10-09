import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { point } from './coordinates';
import { InteractionEngine } from './engine';
import { MemoryCanvas, memoryBlock } from './memoryCanvas';
import { MUTATION_INVENTORY, STORE_ROOTS, TOPOLOGY_WRITES, type TopologyWrite } from './mutationInventory';
import { defaultSpeechCatalog, type SpeechCatalog } from './speech';

const ROOT = process.cwd();
const SELF = 'src/core/interaction/mutationInventory.ts';

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function topologyWrites(source: string): Set<TopologyWrite> {
    const code = stripComments(source);
    const found = new Set<TopologyWrite>();
    for (const name of TOPOLOGY_WRITES) {
        const pattern = name === 'setState'
            ? /\buse(?:Block|Wire|Shell)Store\.setState\s*\(/
            : new RegExp(`\\b${name}\\s*\\(`);
        if (pattern.test(code)) found.add(name);
    }
    return found;
}

const scanned = sourceFiles(join(ROOT, 'src'))
    .map(path => relative(ROOT, path).split('\\').join('/'))
    .filter(file => file !== SELF && !STORE_ROOTS.some(root => file.startsWith(root)))
    .map(file => ({ file, writes: topologyWrites(readFileSync(join(ROOT, file), 'utf8')) }))
    .filter(entry => entry.writes.size > 0);

describe('canvas mutation inventory', () => {
    it('lists every file outside the stores that writes topology or geometry', () => {
        const listed = new Set(MUTATION_INVENTORY.map(entry => entry.file));
        expect(scanned.map(entry => entry.file).filter(file => !listed.has(file))).toEqual([]);
    });

    it.each(MUTATION_INVENTORY.map(entry => [entry.file, entry] as const))('%s: every remaining write is a named exception', (file, entry) => {
        expect(existsSync(join(ROOT, file))).toBe(true);
        const found = [...(scanned.find(item => item.file === file)?.writes ?? [])].sort();
        const declared = [...new Set(entry.exceptions.map(item => item.write))].sort();
        expect(found).toEqual(declared);
        for (const exception of entry.exceptions) {
            expect(exception.in.length).toBeGreaterThan(0);
            expect(exception.reason.length).toBeGreaterThan(0);
        }
    });

    it.each(MUTATION_INVENTORY.filter(entry => entry.routed.length > 0).map(entry => [entry.file, entry] as const))(
        '%s: routed actions call the engine',
        (file, entry) => {
            const code = stripComments(readFileSync(join(ROOT, file), 'utf8'));
            for (const route of entry.routed) expect(code).toContain(`spatialSession.${route.via}(`);
        }
    );

    it('the block close control and block placement never write the store from UI', () => {
        for (const file of ['src/canvas/Canvas.tsx', 'src/components/Sidebar.tsx', 'src/components/CommandPalette.tsx', 'src/canvas/WireHandle.tsx']) {
            const writes = scanned.find(item => item.file === file)?.writes ?? new Set();
            expect(writes.has('addBlock'), file).toBe(false);
            expect(writes.has('removeBlock'), file).toBe(false);
            expect(writes.has('createWire'), file).toBe(false);
            expect(writes.has('addWire'), file).toBe(false);
        }
    });

    it('the scanner catches a planted write and ignores comments', () => {
        expect(topologyWrites('const { removeBlock } = useBlockStore();\nonClose={() => removeBlock(id)}')).toEqual(new Set(['removeBlock']));
        expect(topologyWrites('useWireStore.setState({ wires: [] });')).toEqual(new Set(['setState']));
        expect(topologyWrites('useMindStore.setState({ status: "idle" });')).toEqual(new Set());
        expect(topologyWrites('// removeBlock(id)\n/* addBlock(x) */')).toEqual(new Set());
    });
});

const CATALOG: SpeechCatalog = {
    blocks: [{ blockId: 'hackernews_feed', displayName: 'Hacker News', aliases: ['hacker news'] }, ...defaultSpeechCatalog().blocks],
    shells: defaultSpeechCatalog().shells
};

function board() {
    const canvas = new MemoryCanvas();
    canvas.blocks.push(memoryBlock('hn', { blockId: 'hackernews_feed', name: 'Hacker News' }));
    canvas.blocks.push(memoryBlock('analyst', {
        blockId: 'persona_analyst',
        name: 'Analyst',
        ports: [{ id: 'in', direction: 'input', dataType: 'any' }, { id: 'out', direction: 'output', dataType: 'text' }],
        x: 400
    }));
    return { canvas, engine: new InteractionEngine(canvas, () => CATALOG) };
}

describe('pointer commands through the engine', () => {
    it('pointerCreate places a vocabulary type, records pointer provenance, and undoes', () => {
        const { canvas, engine } = board();
        const command = engine.pointerCreate('hackernews_feed', { x: 40, y: 60 }, 'sidebar-click');
        expect(command).toMatchObject({ lifecycle: 'committed', action: 'create', modalities: ['pointer'] });
        expect(command.evidence).toEqual(['pointer-add:sidebar-click']);
        expect(command.speech).toBeUndefined();
        const created = canvas.getInstance(command.subjects[0])!;
        expect(created.position).toEqual({ x: 40, y: 60 });
        expect(created.schema.display_name).toBe('Hacker News');
        expect(engine.speak('undo').lifecycle).toBe('committed');
        expect(canvas.getInstance(command.subjects[0])).toBeUndefined();
    });

    it('pointerCreate refuses an unknown type or a negative position', () => {
        const { canvas, engine } = board();
        expect(engine.pointerCreate('shell_exec', { x: 0, y: 0 })).toMatchObject({ lifecycle: 'refused', reason: 'unknown-block-type' });
        expect(engine.pointerCreate('hackernews_feed', { x: -1, y: 0 })).toMatchObject({ lifecycle: 'refused', reason: 'out-of-bounds' });
        expect(canvas.blocks).toHaveLength(2);
    });

    it('pointerDelete removes at once, and spoken undo restores it', () => {
        const { canvas, engine } = board();
        expect(engine.pointerDelete('hn')).toMatchObject({ lifecycle: 'committed', action: 'delete', modalities: ['pointer'] });
        expect(canvas.getInstance('hn')).toBeUndefined();
        expect(engine.speak('undo').lifecycle).toBe('committed');
        expect(canvas.getInstance('hn')).toBeDefined();
        expect(engine.pointerDelete('missing')).toMatchObject({ lifecycle: 'refused', reason: 'missing-block' });
    });

    it('closing a block drops a spoken delete preview for it, so a later confirm cannot fire', () => {
        const { canvas, engine } = board();
        engine.select(['hn']);
        expect(engine.speak('delete this').lifecycle).toBe('previewing');
        engine.pointerDelete('hn');
        expect(engine.snapshot().preview).toBeNull();
        expect(engine.speak('confirm')).toMatchObject({ lifecycle: 'refused', reason: 'nothing-pending' });
        expect(canvas.blocks.map(block => block.instance_id)).toEqual(['analyst']);
    });

    it('a confirm whose block vanished elsewhere refuses and clears the preview', () => {
        const { canvas, engine } = board();
        engine.select(['hn']);
        engine.speak('delete this');
        canvas.remove('hn');
        expect(engine.speak('confirm')).toMatchObject({ lifecycle: 'refused', reason: 'missing-block' });
        expect(engine.snapshot().preview).toBeNull();
    });

    it('pointerConnect uses the same admission as spoken wiring and undoes', () => {
        const { canvas, engine } = board();
        expect(engine.pointerConnect('analyst', 'hn')).toMatchObject({ lifecycle: 'refused' });
        expect(canvas.wires).toHaveLength(0);
        const wired = engine.pointerConnect('hn', 'analyst');
        expect(wired).toMatchObject({ lifecycle: 'committed', action: 'connect', target: 'analyst', modalities: ['pointer'] });
        expect(canvas.wires).toHaveLength(1);
        engine.undo();
        expect(canvas.wires).toHaveLength(0);
    });

    it('the speech-disabled path works with no speech adapter constructed', () => {
        const { canvas, engine } = board();
        engine.notePoint(point('canvas', 10, 10), Date.now());
        const placed = engine.pointerCreate('persona_researcher', { x: 700, y: 20 });
        expect(placed.lifecycle).toBe('committed');
        expect(engine.pointerMove(placed.subjects[0], { x: 720, y: 40 }).lifecycle).toBe('committed');
        expect(engine.pointerConnect('hn', placed.subjects[0]).lifecycle).toBe('committed');
        expect(engine.pointerDelete(placed.subjects[0]).lifecycle).toBe('committed');
        expect(engine.snapshot().traces.every(trace => trace.speechObservationId === undefined)).toBe(true);
        expect(canvas.blocks).toHaveLength(2);
    });
});
