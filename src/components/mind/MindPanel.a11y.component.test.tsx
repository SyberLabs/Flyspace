// @vitest-environment happy-dom
// ============================================
// MindPanel is a modal dialog: announced, Escape-closable, focused on open,
// with every icon-only control named.
// ============================================

import type { ReactNode, ComponentProps } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MindPanel } from './MindPanel';

const think = vi.fn();
vi.mock('@/core/services/mind.engine', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/core/services/mind.engine')>()),
    getMindEngine: () => ({ think })
}));
// happy-dom cancels framer-motion's animations as an unhandled rejection.
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }:
            ComponentProps<'div'> & Record<'initial' | 'animate' | 'exit' | 'transition', unknown>) =>
            <div {...rest}>{children}</div>
    },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>
}));

beforeEach(() => think.mockReset());

describe('MindPanel a11y', () => {
    it('is a modal dialog labelled by its visible heading, and focus lands inside on open', () => {
        render(<MindPanel isOpen onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'The Mind' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const heading = screen.getByRole('heading', { name: 'The Mind' });
        expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('names its icon-only header controls and closes on Escape', () => {
        const onClose = vi.fn();
        render(<MindPanel isOpen onClose={onClose} />);
        const dialog = screen.getByRole('dialog', { name: 'The Mind' });
        expect(within(dialog).getByRole('button', { name: 'Close The Mind' })).toBeTruthy();
        expect(within(dialog).getByRole('button', { name: 'Cursor Mode' })).toBeTruthy();
        expect(within(dialog).getByRole('button', { name: 'Context Highlighter' })).toBeTruthy();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('leaves Escape to the Think result while that is open, so the panel stays', async () => {
        think.mockResolvedValue({ success: true, response: 'A market prices an event.' });
        const onClose = vi.fn();
        render(<MindPanel isOpen onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: /Think/ }));
        await screen.findByText('A market prices an event.');

        fireEvent.keyDown(screen.getByRole('dialog', { name: 'The Mind' }), { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('renders nothing when closed', () => {
        render(<MindPanel isOpen={false} onClose={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
