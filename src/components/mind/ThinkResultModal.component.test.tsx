// @vitest-environment happy-dom
// ============================================
// A Think reply is model output. It reaches the persisted observations pool
// (which a Memory block can wire into a persona prompt) only through the
// "Keep as observation" click, and that click is an interaction-engine
// command: admitted, traced, undoable. An error string is never keepable.
// ============================================

import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThinkResultModal } from './ThinkResultModal';
import { spatialSession } from '@/core/interaction/session';
import { useMindStore } from '@/core/stores/mindStore';
import { createInitialMindState } from '@/core/schemas/mind.schema';

// happy-dom cancels framer-motion's animations as an unhandled rejection.
vi.mock('framer-motion', () => ({
    motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>
}));

const observations = () =>
    useMindStore.getState().contextPools.find(p => p.id === 'observations')?.entries ?? [];

beforeEach(() => useMindStore.setState(createInitialMindState()));

describe('ThinkResultModal', () => {
    it('shows the reply without writing it to observations', () => {
        render(<ThinkResultModal isOpen ok onClose={() => {}} response="Rates look steady." personaName="Analyst" />);
        expect(screen.getByText('Rates look steady.')).toBeTruthy();
        expect(observations()).toEqual([]);
    });

    it('keeps the reply through the interaction engine, and undo takes it back out', () => {
        const onClose = vi.fn();
        const before = spatialSession.snapshot().commands.length;
        render(<ThinkResultModal isOpen ok onClose={onClose} response="Rates look steady." personaName="Analyst" />);

        fireEvent.click(screen.getByText('Keep as observation'));

        expect(observations()).toHaveLength(1);
        expect(observations()[0]).toMatchObject({
            type: 'analysis',
            content: 'Rates look steady.',
            metadata: { source: 'Analyst' }
        });
        const commands = spatialSession.snapshot().commands;
        expect(commands).toHaveLength(before + 1);
        expect(commands.at(-1)).toMatchObject({
            action: 'keep',
            lifecycle: 'committed',
            target: 'observations',
            subjects: [observations()[0].id]
        });
        expect(onClose).toHaveBeenCalled();

        expect(spatialSession.undo()).toBe(true);
        expect(observations()).toEqual([]);
    });

    it('offers no Keep action for a failed Think', () => {
        render(<ThinkResultModal isOpen ok={false} onClose={() => {}} response="Error: Ollama is not running" personaName="Analyst" />);
        expect(screen.getByText('Error: Ollama is not running')).toBeTruthy();
        expect(screen.queryByText('Keep as observation')).toBeNull();
        expect(screen.getByText('Copy')).toBeTruthy();
    });
});
