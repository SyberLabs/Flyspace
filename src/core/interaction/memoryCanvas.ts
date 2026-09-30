// In-memory CanvasMutator for conformance tests and the field harness.
// No stores, no persistence.

import type { BlockInstance, PortSchema } from '@/core/schemas/block.schema';
import type { CanvasMutator } from './engine';
import type { SpeechShellKind } from './speech';
import type { CanvasBlockView } from './types';

const ANY_IN: PortSchema = { id: 'in', direction: 'input', dataType: 'any' };
const TEXT_OUT: PortSchema = { id: 'out', direction: 'output', dataType: 'text' };
const JSON_OUT: PortSchema = { id: 'out', direction: 'output', dataType: 'json' };

export function memoryBlock(id: string, options: {
    blockId?: string;
    name?: string;
    tags?: string[];
    ports?: PortSchema[];
    shellId?: string;
    x?: number;
    y?: number;
} = {}): BlockInstance {
    return {
        instance_id: id,
        schema: {
            block_id: options.blockId ?? id,
            display_name: options.name ?? id,
            category: 'workspace',
            data_type: 'custom',
            refresh_rate: 'manual',
            semantic_tags: options.tags ?? [],
            wiring_logic: 'none',
            ports: options.ports ?? [JSON_OUT]
        },
        status: 'disconnected',
        last_updated: null,
        data: null,
        position: { x: options.x ?? 0, y: options.y ?? 0 },
        dimensions: { width: 200, height: 120 },
        shellId: options.shellId ?? 'root'
    };
}

export class MemoryCanvas implements CanvasMutator {
    blocks: BlockInstance[] = [];
    wires: Array<{ id: string; source: string; target: string }> = [];
    shell = 'root';
    private created = 0;

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
        this.created += 1;
        const id = `${blockId}_${this.created}`;
        this.blocks.push(memoryBlock(id, {
            blockId,
            name: displayName,
            ports: blockId.startsWith('persona') ? [ANY_IN, TEXT_OUT] : [JSON_OUT],
            shellId: this.shell,
            x,
            y
        }));
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
    openShell(target: SpeechShellKind) {
        const previousShellId = this.shell;
        this.shell = target.kind === 'root' ? 'root' : target.id;
        return { ok: true as const, name: target.name, previousShellId };
    }
}
