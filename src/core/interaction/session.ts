// Store-backed canvas authority. Sensors do not import this module.

import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useBlockStore } from '@/core/stores/blockStore';
import { useShellStore } from '@/core/stores/shellStore';
import { useWireStore } from '@/core/stores/wireStore';
import { getShellTemplate, SHELL_TEMPLATES } from '@/core/shells/templates';
import type { BlockInstance } from '@/core/schemas/block.schema';
import { InteractionEngine, type CanvasMutator } from './engine';
import type { SpeechCatalog, SpeechShellKind } from './speech';
import type { CanvasBlockView } from './types';

function view(block: BlockInstance): CanvasBlockView {
    return {
        id: block.instance_id,
        shellId: block.shellId,
        blockId: block.schema.block_id,
        name: block.schema.display_name,
        tags: block.schema.semantic_tags ?? [],
        x: block.position.x,
        y: block.position.y,
        width: block.dimensions.width,
        height: block.dimensions.height
    };
}

function createStoreMutator(): CanvasMutator {
    return {
        listBlocks() {
            return useBlockStore.getState().blocks.map(view);
        },
        getInstance(id) {
            return useBlockStore.getState().getBlock(id);
        },
        activeShell() {
            return useBlockStore.getState().activeShellId;
        },
        move(id, x, y) {
            const block = useBlockStore.getState().getBlock(id);
            const from = { x: block?.position.x ?? 0, y: block?.position.y ?? 0 };
            useBlockStore.getState().updatePosition(id, { x, y });
            return from;
        },
        add(blockId, displayName, x, y) {
            const schema = blockRegistry.get(blockId);
            if (!schema) throw new Error(`Unknown block type: ${blockId}`);
            return useBlockStore.getState().addBlock({ ...schema, display_name: displayName }, { x, y });
        },
        remove(id) {
            const block = useBlockStore.getState().getBlock(id);
            if (!block) return undefined;
            useBlockStore.getState().removeBlock(id);
            return block;
        },
        restore(block) {
            useBlockStore.setState(state => ({ blocks: [...state.blocks, block] }));
        },
        connect(sourceId, targetId) {
            const wireId = useWireStore.getState().addWire(sourceId, targetId);
            if (!wireId) {
                return { ok: false, reason: useWireStore.getState().lastAdmissionRefusal ?? 'refused' };
            }
            return { ok: true, wireId };
        },
        disconnect(wireId) {
            useWireStore.getState().removeWire(wireId);
        },
        openShell(target: SpeechShellKind) {
            const previousShellId = useBlockStore.getState().activeShellId;
            if (target.kind === 'root') {
                useBlockStore.getState().setActiveShell('root');
                return { ok: true as const, name: target.name, previousShellId };
            }
            if (target.kind === 'saved') {
                const ok = useShellStore.getState().loadShell(target.id);
                return ok
                    ? { ok: true as const, name: target.name, previousShellId }
                    : { ok: false as const, reason: 'missing-shell' };
            }
            const template = getShellTemplate(target.id);
            if (!template) return { ok: false as const, reason: 'missing-shell' };
            const existing = useShellStore.getState().shells
                .filter(shell => shell.name === template.name)
                .sort((left, right) => (right.lastAccessedAt ?? 0) - (left.lastAccessedAt ?? 0));
            if (existing[0]) {
                const ok = useShellStore.getState().loadShell(existing[0].id);
                return ok
                    ? { ok: true as const, name: existing[0].name, previousShellId }
                    : { ok: false as const, reason: 'missing-shell' };
            }
            const created = useShellStore.getState().instantiateTemplate(template);
            return created
                ? { ok: true as const, name: template.name, previousShellId }
                : { ok: false as const, reason: 'missing-shell' };
        }
    };
}

function aliasesFor(displayName: string): string[] {
    return [displayName.toLowerCase()];
}

function productionSpeechCatalog(): SpeechCatalog {
    const saved = useShellStore.getState().shells.map(shell => ({
        id: shell.id,
        name: shell.name,
        kind: 'saved' as const,
        aliases: [shell.name.toLowerCase()]
    }));
    return {
        blocks: blockRegistry.getAll().map(block => ({
            blockId: block.block_id,
            displayName: block.display_name,
            aliases: aliasesFor(block.display_name)
        })),
        shells: [
            { id: 'root', name: 'Root', kind: 'root', aliases: ['root', 'home', 'root shell'] },
            ...SHELL_TEMPLATES.map(template => ({
                id: template.id,
                name: template.name,
                kind: 'template' as const,
                aliases: [template.name.toLowerCase(), template.name.toLowerCase().replace(/ shell$/, '')]
            })),
            ...saved
        ]
    };
}

export const spatialSession = new InteractionEngine(createStoreMutator(), productionSpeechCatalog);
