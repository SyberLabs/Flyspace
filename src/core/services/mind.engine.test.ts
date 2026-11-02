import { beforeEach, describe, expect, it } from 'vitest';
import { thinkInPreview } from './mind.engine';
import { PREVIEW_AI_OFF_MESSAGE } from './personaTurn.service';
import { useBlockStore, useMindStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import type { BlockInstance } from '@/core/schemas/block.schema';
import type { DataWire } from '@/core/schemas/wire.schema';

const NOTHING_IN_SCOPE = /^Nothing to think about/;
const firstPersona = useMindStore.getState().personas[0].id;

function block(id: string, shellId = 'root'): BlockInstance {
    return {
        instance_id: id,
        schema: { block_id: 'fred_series', display_name: id, category: 'truth' },
        status: 'connected',
        last_updated: null,
        data: { value: 1 },
        position: { x: 0, y: 0 },
        dimensions: { width: 100, height: 80 },
        shellId
    } as unknown as BlockInstance;
}

function wire(from: string, to: string): DataWire {
    return { id: `${from}-${to}`, sourceBlockId: from, targetBlockId: to, shellId: 'root' } as unknown as DataWire;
}

function expectOutcome(question: string | undefined, message: string | RegExp, status: 'error' | 'ready') {
    const said = thinkInPreview(question);
    if (typeof message === 'string') expect(said).toBe(message);
    else expect(said).toMatch(message);
    expect(useMindStore.getState().status).toBe(status);
}

beforeEach(() => {
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
    useMindStore.setState({ activePersonaId: firstPersona, status: 'initializing' });
    useMindStore.getState().clearFocus();
});

describe('thinkInPreview', () => {
    it('says so when no persona is active, whatever is in scope', () => {
        useMindStore.setState({ activePersonaId: 'nobody' });
        expectOutcome(undefined, 'No active persona', 'error');
        expectOutcome('A question', 'No active persona', 'error');
    });

    it('refuses for an empty scope and leaves the Mind ready', () => {
        expectOutcome(undefined, NOTHING_IN_SCOPE, 'ready');
    });

    it('treats a blank question as no question', () => {
        expectOutcome('   ', NOTHING_IN_SCOPE, 'ready');
    });

    it('gives a question with nothing in scope the AI-off message', () => {
        expectOutcome('A question', PREVIEW_AI_OFF_MESSAGE, 'error');
    });

    it('gives a wired scope the AI-off message', () => {
        useBlockStore.setState({ blocks: [block('a'), block('b')] });
        useWireStore.setState({ wires: [wire('a', 'b')] });
        expectOutcome(undefined, PREVIEW_AI_OFF_MESSAGE, 'error');
    });

    it('gives a pinned scope the AI-off message', () => {
        useBlockStore.setState({ blocks: [block('a')] });
        expect(useMindStore.getState().pinBlock('a', 'fred_series', { value: 1 })).toBe(true);
        expectOutcome(undefined, PREVIEW_AI_OFF_MESSAGE, 'error');
    });

    it('does not count a wire or pin in another shell', () => {
        useBlockStore.setState({ blocks: [block('a'), block('b'), block('elsewhere', 'other')] });
        useWireStore.setState({ wires: [wire('a', 'elsewhere')] });
        useMindStore.getState().pinBlock('elsewhere', 'fred_series', { value: 1 });
        expectOutcome(undefined, NOTHING_IN_SCOPE, 'ready');
    });
});
