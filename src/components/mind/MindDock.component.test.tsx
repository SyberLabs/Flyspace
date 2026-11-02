// @vitest-environment happy-dom
// ============================================
// Think refuses when nothing is wired or pinned, and that refusal is routine.
// The dock used to swallow it: Quick Think did nothing and Quick Ask closed
// the chat with the question gone. Both now say what happened. A question skips
// the empty-scope refusal and gets the preview's AI-off message instead.
// ============================================

import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MindDock } from './MindDock';
import { useBlockStore, useMindStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { PREVIEW_AI_OFF_MESSAGE } from '@/core/services/personaTurn.service';

// happy-dom cancels framer-motion's animations as an unhandled rejection.
vi.mock('framer-motion', () => ({
    motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>
}));

const firstPersona = useMindStore.getState().personas[0].id;

function ask(question: string) {
    fireEvent.click(screen.getByTitle('Quick Ask'));
    const input = screen.getByPlaceholderText('Quick question...');
    fireEvent.change(input, { target: { value: question } });
    fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => {
    useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    useWireStore.setState({ wires: [] });
    useMindStore.setState({ activePersonaId: firstPersona });
});

describe('MindDock', () => {
    it('shows why Quick Think did nothing when the scope is empty', async () => {
        render(<MindDock onExpandPanel={() => {}} />);

        fireEvent.click(screen.getByTitle('Think (analyze context)'));

        expect(await screen.findByText(/Nothing to think about/)).toBeTruthy();
    });

    it('answers a Quick Ask question in an unwired shell with the AI-off message, and closes the chat', async () => {
        render(<MindDock onExpandPanel={() => {}} />);

        ask('what is a market?');

        expect(await screen.findByText(PREVIEW_AI_OFF_MESSAGE)).toBeTruthy();
        expect(screen.queryByPlaceholderText('Quick question...')).toBeNull();
    });

    it('sends nothing for a blank Quick Ask', () => {
        render(<MindDock onExpandPanel={() => {}} />);

        ask('   ');

        expect(screen.queryByText(PREVIEW_AI_OFF_MESSAGE)).toBeNull();
        expect(screen.getByPlaceholderText('Quick question...')).toBeTruthy();
    });

    it('shows the error when Quick Ask fails', async () => {
        useMindStore.setState({ activePersonaId: 'nobody' });
        render(<MindDock onExpandPanel={() => {}} />);

        ask('hello');

        expect(await screen.findByText('No active persona')).toBeTruthy();
    });
});
