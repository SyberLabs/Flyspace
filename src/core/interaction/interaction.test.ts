import { describe, expect, it, beforeEach } from 'vitest';
import { evaluateWireAdmission, portsCompatible } from './ports';
import { InteractionEngine, type CanvasMutator } from './engine';
import { stepPinch, initialPinch, PINCH_ACTIVATE_DISTANCE, PINCH_RELEASE_DISTANCE, PINCH_STABLE_MS } from './pinch';
import { resolveReferents } from './referent';
import { parseSpeech } from './speech';
import { cameraNormalizedToCanvas, point } from './coordinates';
import { framesFromLandmarker } from './handLandmarker';
import { resetSeparation } from './separation';
import type { BlockInstance, PortSchema } from '@/core/schemas/block.schema';
import type { CanvasBlockView, HandObservationFrame } from './types';
import { useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';

function block(id: string, ports: PortSchema[], shellId = 'root'): BlockInstance {
    return {
        instance_id: id,
        schema: {
            block_id: id,
            display_name: id,
            category: 'workspace',
            data_type: 'custom',
            refresh_rate: 'manual',
            semantic_tags: [],
            wiring_logic: 'none',
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
        return item;
    }
    restore(entry: BlockInstance) { this.blocks.push(entry); }
    connect(sourceId: string, targetId: string) {
        const wireId = `wire_${this.wires.length + 1}`;
        this.wires.push({ id: wireId, source: sourceId, target: targetId });
        return { ok: true as const, wireId };
    }
    disconnect(wireId: string) { this.wires = this.wires.filter(wire => wire.id !== wireId); }
    setGroup() {}
}

function hand(distance: number, confidence = 0.9): HandObservationFrame {
    return {
        handId: 'camera-0',
        handedness: 'right',
        trackingConfidence: confidence,
        coordinateSpace: 'camera_normalized',
        landmarks: [
            { joint: '4', x: 0.4, y: 0.4, z: 0 },
            { joint: '8', x: 0.4 + distance, y: 0.4, z: 0 },
            { joint: 'index_tip', x: 0.5, y: 0.5, z: 0 }
        ]
    };
}

describe('spatial command lifecycle', () => {
    let canvas: MemoryCanvas;
    let engine: InteractionEngine;

    beforeEach(() => {
        resetSeparation();
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

    it('refuses a typed connect and honors keep-apart', () => {
        canvas.blocks.push(block('note', [textOut]));
        canvas.blocks[1].schema.display_name = 'Note';
        canvas.blocks[1].position = { x: 400, y: 10 };
        canvas.blocks.push(block('typed', [textIn]));
        canvas.blocks[2].schema.display_name = 'Typed';
        engine.select(['news', 'typed']);
        const refused = engine.speak('connect this to that', 4000);
        expect(refused.lifecycle).toBe('refused');
        expect(canvas.wires).toHaveLength(0);

        engine.select(['news', 'note']);
        expect(engine.speak('keep these apart', 4100).lifecycle).toBe('committed');
        const again = engine.speak('connect this to that', 4200);
        expect(again.lifecycle).toBe('refused');
        expect(again.reason).toBe('kept-separate');
    });

    it('commits a pinch move and cancels when tracking drops', () => {
        const start = 10_000;
        engine.setViewport({ width: 200, height: 100, panX: 0, panY: 0, zoom: 1 });
        engine.observeHand(hand(PINCH_ACTIVATE_DISTANCE - 0.01), start);
        engine.observeHand(hand(PINCH_ACTIVATE_DISTANCE - 0.01), start + PINCH_STABLE_MS);
        expect(engine.snapshot().preview?.lifecycle).toBe('previewing');
        const lost = engine.observeHand({ ...hand(0.01), trackingConfidence: 0, landmarks: [] }, start + 500);
        expect(lost?.reason).toBe('tracking-lost');
        expect(canvas.getInstance('news')?.position).toEqual({ x: 10, y: 10 });
    });

    it('does not write landmarks or video into the committed trace', () => {
        const start = 20_000;
        engine.setViewport({ width: 200, height: 100, panX: 0, panY: 0, zoom: 1 });
        engine.observeHand(hand(0.02), start);
        engine.observeHand(hand(0.02), start + PINCH_STABLE_MS);
        engine.observeHand(hand(PINCH_RELEASE_DISTANCE + 0.01), start + PINCH_STABLE_MS + 40);
        const encoded = JSON.stringify(engine.snapshot());
        expect(encoded).not.toContain('landmarks');
        expect(encoded).not.toContain('video');
        expect(engine.snapshot().traces.some(trace => trace.command === 'MOVE')).toBe(true);
    });
});

describe('pinch hysteresis and deixis', () => {
    it('does not activate on a single frame under the threshold', () => {
        const first = stepPinch(initialPinch('h'), {
            distance: PINCH_ACTIVATE_DISTANCE - 0.01,
            at: 0,
            anchor: { x: 1, y: 1 },
            tracking: true
        });
        expect(first.phase).toBe('candidate');
        const bounced = stepPinch(first, {
            distance: PINCH_ACTIVATE_DISTANCE + 0.01,
            at: 30,
            anchor: { x: 1, y: 1 },
            tracking: true
        });
        expect(bounced.phase).toBe('inactive');
    });

    it('activates only after the stable window and releases on the wider threshold', () => {
        let state = initialPinch('h');
        state = stepPinch(state, { distance: 0.05, at: 0, anchor: { x: 0, y: 0 }, tracking: true });
        state = stepPinch(state, { distance: 0.05, at: PINCH_STABLE_MS, anchor: { x: 0, y: 0 }, tracking: true });
        expect(state.phase).toBe('active');
        state = stepPinch(state, { distance: 0.1, at: PINCH_STABLE_MS + 20, anchor: { x: 0, y: 0 }, tracking: true });
        expect(state.phase).toBe('active');
        state = stepPinch(state, { distance: PINCH_RELEASE_DISTANCE, at: PINCH_STABLE_MS + 40, anchor: { x: 0, y: 0 }, tracking: true });
        expect(state.phase).toBe('end');
    });

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
        expect(parseSpeech('compare these')?.action).toBe('compare');
        expect(parseSpeech('wave at the canvas')).toBeNull();
    });

    it('maps camera-normalized points explicitly into canvas space', () => {
        const canvasPoint = cameraNormalizedToCanvas(point('camera_normalized', 0.5, 1), {
            width: 200, height: 100, panX: 0, panY: 0, zoom: 1
        });
        expect(canvasPoint).toEqual({ frame: 'canvas', x: 100, y: 100 });
    });

    it('turns landmarker output into observations without retaining an image', () => {
        const frames = framesFromLandmarker({
            landmarks: [[{ x: 0.1, y: 0.2, z: 0 }, { x: 0.2, y: 0.2, z: 0 }]],
            handedness: [[{ categoryName: 'Right', score: 0.8 }]]
        });
        expect(frames[0].handedness).toBe('right');
        expect(frames[0].landmarks[0]).toMatchObject({ joint: 'wrist', x: 0.1, y: 0.2 });
        expect(JSON.stringify(frames)).not.toContain('data:image');
    });
});
