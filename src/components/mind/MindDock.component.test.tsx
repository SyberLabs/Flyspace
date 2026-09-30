// @vitest-environment happy-dom
// ============================================
// Think refuses when nothing is wired or pinned, and that refusal is routine.
// The dock used to swallow it: Quick Think did nothing and Quick Ask closed
// the chat with the question gone. Both now say what happened, and Quick Ask
// always sends its question so it never hits the empty-scope refusal.
// ============================================

import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MindDock } from './MindDock';

const think = vi.fn();
vi.mock('@/core/services/mind.engine', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/core/services/mind.engine')>()),
    getMindEngine: () => ({ think })
}));
// happy-dom cancels framer-motion's animations as an unhandled rejection.
vi.mock('framer-motion', () => ({
    motion: { div: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>
}));

beforeEach(() => think.mockReset());

describe('MindDock', () => {
    it('shows why Quick Think did nothing when the scope is empty', async () => {
        think.mockResolvedValue({ success: false, error: 'Nothing to think about: no wired or pinned blocks' });
        render(<MindDock onExpandPanel={() => {}} />);

        fireEvent.click(screen.getByTitle('Think (analyze context)'));

        expect(await screen.findByText(/Nothing to think about/)).toBeTruthy();
    });

    it('sends the Quick Ask question, so an unwired shell still gets an answer', async () => {
        think.mockResolvedValue({ success: true, response: 'A market prices an event.' });
        render(<MindDock onExpandPanel={() => {}} />);

        fireEvent.click(screen.getByTitle('Quick Ask'));
        const input = screen.getByPlaceholderText('Quick question...');
        fireEvent.change(input, { target: { value: 'what is a market?' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(await screen.findByText('A market prices an event.')).toBeTruthy();
        expect(think).toHaveBeenCalledWith('User asks: what is a market?');
    });

    it('shows the error when Quick Ask fails', async () => {
        think.mockResolvedValue({ success: false, error: 'Ollama is not running' });
        render(<MindDock onExpandPanel={() => {}} />);

        fireEvent.click(screen.getByTitle('Quick Ask'));
        const input = screen.getByPlaceholderText('Quick question...');
        fireEvent.change(input, { target: { value: 'hello' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(await screen.findByText('Ollama is not running')).toBeTruthy();
    });
});
