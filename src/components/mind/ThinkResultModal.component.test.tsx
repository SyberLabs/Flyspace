// @vitest-environment happy-dom
// ============================================
// A Think reply is model output. It reaches the persisted observations pool
// (which a Memory block can wire into a persona prompt) only through the
// "Keep as observation" click here, never from the engine.
// ============================================

import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThinkResultModal } from './ThinkResultModal';
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
        render(<ThinkResultModal isOpen onClose={() => {}} response="Rates look steady." personaName="Analyst" />);
        expect(screen.getByText('Rates look steady.')).toBeTruthy();
        expect(observations()).toEqual([]);
    });

    it('writes the reply to observations only on "Keep as observation"', () => {
        const onClose = vi.fn();
        render(<ThinkResultModal isOpen onClose={onClose} response="Rates look steady." personaName="Analyst" />);

        fireEvent.click(screen.getByText('Keep as observation'));

        expect(observations()).toHaveLength(1);
        expect(observations()[0]).toMatchObject({
            type: 'analysis',
            content: 'Rates look steady.',
            metadata: { source: 'Analyst' }
        });
        expect(onClose).toHaveBeenCalled();
    });
});
