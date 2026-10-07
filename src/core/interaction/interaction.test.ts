import { describe, expect, it, beforeEach } from 'vitest';
import { evaluateWireAdmission, portsCompatible } from './ports';
import { InteractionEngine, type CanvasMutator, type RemovedBlock } from './engine';
import { resolveReferents } from './referent';
import { parseSpeech } from './speech';
import { point } from './coordinates';
import type { BlockInstance, PortSchema } from '@/core/schemas/block.schema';
import type { CanvasBlockView } from './types';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';

function block(id: string, ports: PortSchema[], shellId = 'root'): BlockInstance {
    return {
        instance_id: id,
        schema: {
            block_id: id,
            display_name: id,
            category: 'workspace',
            semantic_tags: [],
            ports
        },
        status: 'disconnected',
        last_updated: null,
        data: null,
        position: { x: 0, y: 0 },
        dimensions: { width: 200, height: 120 },
        shellId
    };
}

const jsonOut: PortSchema = { id: 'out', direction: 'output', dataType: 'json' };
const textOut: PortSchema = { id: 'out', direction: 'output', dataType: 'text' };
const textIn: PortSchema = { id: 'in', direction: 'input', dataType: 'text' };
const anyIn: PortSchema = { id: 'in', direction: 'input', dataType: 'any' };

describe('typed wire admission', () => {
    it('admits json into any and text into text', () => {
        expect(portsCompatible('json', 'any')).toBe(true);
        expect(portsCompatible('text', 'text')).toBe(true);
        expect(evaluateWireAdmission(block('a', [jsonOut]), block('b', [anyIn])).ok).toBe(true);
    });

    it('refuses a type mismatch, a cross-shell edge, and a self-wire', () => {
        expect(evaluateWireAdmission(block('a', [jsonOut]), block('b', [textIn])).ok).toBe(false);
        expect(evaluateWireAdmission(block('a', [textOut], 'root'), block('b', [textIn], 'other')).ok).toBe(false);
        expect(evaluateWireAdmission(block('a', [textOut, textIn]), block('a', [textOut, textIn])).ok).toBe(false);
    });

    it('refuses the wire in the store and leaves the graph unchanged', () => {
        useBlockStore.setState({
            blocks: [block('src', [jsonOut]), block('dst', [textIn])],
            activeShellId: 'root'
        });
        useWireStore.setState({ wires: [], lastAdmissionRefusal: null });
        const id = useWireStore.getState().addWire('src', 'dst');
        expect(id).toBe('');
        expect(useWireStore.getState().wires).toHaveLength(0);
        expect(useWireStore.getState().lastAdmissionRefusal).toBe('incompatible-type');
    });
});

class MemoryCanvas implements CanvasMutator {
    blocks: BlockInstance[] = [];
    wires: Array<{ id: string; source: string; target: string }> = [];
    kept: Array<{ id: string; poolId: string; content: string }> = [];
    shell = 'root';

    listBlocks(): CanvasBlockView[] {
        return this.blocks.map(item => ({
            id: item.instance_id,
            shellId: item.shellId,
            blockId: item.schema.block_id,
            name: item.schema.display_name,
            tags: item.schema.semantic_tags,
            x: item.position.x,
            y: item.position.y,
            width: item.dimensions.width,
            height: item.dimensions.height
        }));
    }
    getInstance(id: string) { return this.blocks.find(item => item.instance_id === id); }
    activeShell() { return this.shell; }
    move(id: string, x: number, y: number) {
        const item = this.getInstance(id)!;
        const from = { ...item.position };
        item.position = { x, y };
        return from;
    }
    add(blockId: string, displayName: string, x: number, y: number) {
        const id = `${blockId}_${this.blocks.length + 1}`;
        this.blocks.push(block(id, blockId.startsWith('persona') ? [anyIn, textOut] : [textOut], this.shell));
        const created = this.blocks[this.blocks.length - 1];
        created.schema.block_id = blockId;
        created.schema.display_name = displayName;
        created.position = { x, y };
        return id;
    }
    remove(id: string) {
        const item = this.getInstance(id);
        this.blocks = this.blocks.filter(entry => entry.instance_id !== id);
        return item ? { block: item, wires: [] } : undefined;
    }
    restore(removed: RemovedBlock) { this.blocks.push(removed.block); }
    connect(sourceId: string, targetId: string) {
        const wireId = `wire_${this.wires.length + 1}`;
        this.wires.push({ id: wireId, source: sourceId, target: targetId });
        return { ok: true as const, wireId };
    }
    disconnect(wireId: string) { this.wires = this.wires.filter(wire => wire.id !== wireId); }
    keep(poolId: string, entry: { content: string }) {
        const id = `kept_${this.kept.length + 1}`;
        this.kept.push({ id, poolId, content: entry.content });
        return id;
    }
    unkeep(poolId: string, entryId: string) {
        this.kept = this.kept.filter(item => !(item.poolId === poolId && item.id === entryId));
    }
    openShell(target: { id: string; name: string; kind: 'root' | 'template' | 'saved' }) {
        const previousShellId = this.shell;
        this.shell = target.kind === 'root' ? 'root' : target.id;
        return { ok: true as const, name: target.name, previousShellId };
    }
}

describe('spatial command lifecycle', () => {
    let canvas: MemoryCanvas;
    let engine: InteractionEngine;

    beforeEach(() => {
        canvas = new MemoryCanvas();
        canvas.blocks.push(block('news', [jsonOut]));
        canvas.blocks[0].schema.display_name = 'News Feed';
        canvas.blocks[0].schema.semantic_tags = ['news'];
        canvas.blocks[0].position = { x: 10, y: 10 };
        engine = new InteractionEngine(canvas);
    });

    it('moves on pointer release and undoes back to the origin', () => {
        const command = engine.pointerMove('news', { x: 40, y: 50 }, 1);
        expect(command.lifecycle).toBe('committed');
        expect(canvas.getInstance('news')?.position).toEqual({ x: 40, y: 50 });
        expect(engine.undo()).toBe(true);
        expect(canvas.getInstance('news')?.position).toEqual({ x: 10, y: 10 });
    });

    it('holds when two blocks sit under the same point', () => {
        canvas.blocks.push(block('other', [textOut]));
        canvas.blocks[1].position = { x: 10, y: 10 };
        engine.notePoint(point('canvas', 20, 20), 1000);
        const command = engine.speak('put this here', 1100);
        expect(command.lifecycle).toBe('held');
        expect(command.reason).toBe('ambiguous');
        expect(canvas.blocks).toHaveLength(2);
    });

    it('places a researcher where the user pointed, and refuses unknown speech', () => {
        engine.notePoint(point('canvas', 300, 180), 2000);
        const placed = engine.speak('put a researcher here', 2100);
        expect(placed.lifecycle).toBe('committed');
        expect(canvas.blocks.some(item => item.schema.block_id === 'persona_researcher')).toBe(true);
        expect(engine.speak('make it pop')).toMatchObject({ lifecycle: 'refused', reason: 'unrecognized-speech' });
    });

    it('keeps a reply in a pool as a committed command, refuses empty text, and undo removes it', () => {
        const entry = { type: 'analysis' as const, content: 'Rates look steady.', importance: 0.8 };
        const command = engine.keep('observations', entry, 4000);
        expect(command).toMatchObject({ lifecycle: 'committed', action: 'keep', target: 'observations', modalities: ['pointer'] });
        expect(canvas.kept).toEqual([{ id: 'kept_1', poolId: 'observations', content: 'Rates look steady.' }]);
        expect(engine.snapshot().traces.at(-1)).toMatchObject({ command: 'KEEP', subject: 'kept_1', target: 'observations' });

        expect(engine.keep('observations', { ...entry, content: '   ' }, 4100)).toMatchObject({ lifecycle: 'refused', reason: 'empty-content' });
        expect(canvas.kept).toHaveLength(1);

        expect(engine.undo()).toBe(true);
        expect(canvas.kept).toEqual([]);
        expect(engine.snapshot().commands.find(item => item.id === command.id)?.lifecycle).toBe('undone');
    });

    it('places a block on a click as a committed pointer command, and undo removes it', () => {
        const before = canvas.blocks.length;
        const command = engine.place('capability_weather', 'Weather timeline', { x: 420, y: 260 }, 4200);
        expect(command).toMatchObject({ lifecycle: 'committed', action: 'create', modalities: ['pointer'] });
        const placed = canvas.blocks.at(-1)!;
        expect(canvas.blocks).toHaveLength(before + 1);
        expect(command.subjects).toEqual([placed.instance_id]);
        expect(engine.snapshot().traces.at(-1)).toMatchObject({
            command: 'CREATE', subject: placed.instance_id, to: { x: 420, y: 260 }, modalities: ['pointer']
        });

        expect(engine.undo()).toBe(true);
        expect(canvas.blocks).toHaveLength(before);
        expect(engine.snapshot().commands.find(item => item.id === command.id)?.lifecycle).toBe('undone');
    });

    it('refuses to place an empty or unknown block instead of throwing', () => {
        expect(engine.place('', 'Nothing', { x: 0, y: 0 })).toMatchObject({ lifecycle: 'refused', reason: 'empty-block' });

        const throwing = new MemoryCanvas();
        throwing.add = () => { throw new Error('Unknown block type: gone'); };
        const strict = new InteractionEngine(throwing);
        expect(strict.place('gone', 'Gone', { x: 0, y: 0 })).toMatchObject({ lifecycle: 'refused', reason: 'unknown-block' });
        expect(throwing.blocks).toHaveLength(0);
    });

    it('previews a delete until confirm, then undo restores the block', () => {
        engine.select(['news']);
        const preview = engine.speak('delete this', 3000);
        expect(preview.lifecycle).toBe('previewing');
        expect(canvas.getInstance('news')).toBeTruthy();
        engine.confirm(3100);
        expect(canvas.getInstance('news')).toBeUndefined();
        engine.undo();
        expect(canvas.getInstance('news')?.instance_id).toBe('news');
    });
});

describe('referents and speech', () => {
    it('holds two candidates and resolves one named block', () => {
        const blocks = [
            { id: 'a', shellId: 'root', blockId: 'news', name: 'News', tags: ['news'], x: 0, y: 0, width: 10, height: 10 },
            { id: 'b', shellId: 'root', blockId: 'note', name: 'Note', tags: ['note'], x: 0, y: 0, width: 10, height: 10 },
            { id: 'c', shellId: 'other', blockId: 'news', name: 'News', tags: ['news'], x: 0, y: 0, width: 10, height: 10 }
        ];
        expect(resolveReferents({
            shellId: 'root', blocks, point: point('canvas', 1, 1), selection: [], recentInteraction: [], recentDiscourse: []
        }).status).toBe('hold');
        expect(resolveReferents({
            shellId: 'root', blocks, selection: [], recentInteraction: [], recentDiscourse: [], noun: 'note'
        })).toEqual({ status: 'resolved', ids: ['b'] });
    });

    it('parses the spoken command set and nothing beyond it', () => {
        expect(parseSpeech('Create a researcher.')?.personaBlockId).toBe('persona_researcher');
        expect(parseSpeech('give these to the analyst')?.action).toBe('connect');
        expect(parseSpeech('wave at the canvas')).toBeNull();
    });

    it('controls the canvas by naming any block, shell, wire, or confirm', () => {
        const catalog = {
            blocks: [
                { blockId: 'hackernews_feed', displayName: 'Hacker News', aliases: ['hacker news'] },
                { blockId: 'newsapi_feed', displayName: 'News Feed', aliases: ['news feed'] },
                { blockId: 'polymarket_live_odds', displayName: 'Polymarket', aliases: ['polymarket'] },
                { blockId: 'persona_analyst', displayName: 'Analyst', aliases: ['analyst'] }
            ],
            shells: [
                { id: 'root', name: 'Root', kind: 'root' as const, aliases: ['root', 'home'] },
                { id: 'tmpl_investor', name: 'Investor Shell', kind: 'template' as const, aliases: ['investor', 'investor shell'] }
            ]
        };
        const board = new MemoryCanvas();
        const voiced = new InteractionEngine(board, () => catalog);

        const added = voiced.speak('add hacker news');
        expect(added.lifecycle).toBe('committed');
        expect(added.summary).toBe('Added Hacker News.');
        expect(board.blocks.some(item => item.schema.block_id === 'hackernews_feed')).toBe(true);

        voiced.speak('add an analyst');
        const wired = voiced.speak('wire hacker news to the analyst');
        expect(wired.lifecycle).toBe('committed');
        expect(wired.summary).toBe('Wired Hacker News to Analyst.');
        expect(board.wires).toHaveLength(1);
        voiced.speak('undo');
        expect(board.wires).toHaveLength(0);
        voiced.speak('wire hacker news to the analyst');

        const waiting = voiced.speak('put polymarket here');
        expect(waiting.lifecycle).toBe('held');
        expect(waiting.summary).toBe('Point at the canvas, then say it again.');
        voiced.notePoint(point('canvas', 48, 64), Date.now());
        expect(voiced.speak('put polymarket here').lifecycle).toBe('committed');

        const opened = voiced.speak('open the investor shell');
        expect(opened.lifecycle).toBe('committed');
        expect(opened.summary).toBe('Opened Investor Shell.');
        expect(board.shell).toBe('tmpl_investor');
        voiced.speak('go to root');
        expect(board.shell).toBe('root');

        expect(parseSpeech('add news', catalog)?.ambiguous).toBe('block');
        expect(parseSpeech('confirm')?.action).toBe('confirm');

        voiced.speak('undo');
        expect(board.shell).toBe('tmpl_investor');
        voiced.speak('undo');
        expect(board.shell).toBe('root');

        const refused = voiced.speak('wire hacker news to polymarket');
        expect(refused.lifecycle).toBe('refused');
        expect(refused.summary).toBe("I can't wire those.");

        const preview = voiced.speak('delete hacker news');
        expect(preview.lifecycle).toBe('previewing');
        expect(preview.summary).toContain('Say confirm to delete');
        const replaced = voiced.speak('add polymarket');
        expect(replaced.lifecycle).toBe('committed');
        expect(board.blocks.some(item => item.schema.display_name === 'Hacker News')).toBe(true);
        expect(voiced.speak('yes').summary).toBe('Nothing is waiting for confirm.');
    });

    it('deletes a block only after a spoken confirm, and a mumble leaves the preview', () => {
        const board = new MemoryCanvas();
        board.blocks.push(block('news', [jsonOut]));
        board.blocks[0].schema.display_name = 'News Feed';
        const voiced = new InteractionEngine(board);
        voiced.select(['news']);
        const preview = voiced.speak('delete this');
        expect(preview.lifecycle).toBe('previewing');
        expect(preview.summary).toBe('Say confirm to delete News Feed.');
        voiced.speak('asdfgh');
        expect(board.getInstance('news')).toBeTruthy();
        expect(voiced.snapshot().preview?.lifecycle).toBe('previewing');
        const confirmed = voiced.speak('confirm');
        expect(confirmed.summary).toBe('Deleted News Feed.');
        expect(board.getInstance('news')).toBeUndefined();
    });
});
