// @vitest-environment happy-dom
// ============================================
// MindPanel is a modal dialog: announced, Escape-closable, focused on open,
// with every icon-only control named.
// ============================================

import type { ReactNode, ComponentProps } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MindPanel } from './MindPanel';

// happy-dom cancels framer-motion's animations as an unhandled rejection.
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }:
            ComponentProps<'div'> & Record<'initial' | 'animate' | 'exit' | 'transition', unknown>) =>
            <div {...rest}>{children}</div>
    },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>
}));

afterEach(() => vi.restoreAllMocks());

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

    it('leaves Escape to the context capture while that is open, so the panel stays', async () => {
        vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'A market prices an event.' } as Selection);
        const onClose = vi.fn();
        render(<MindPanel isOpen onClose={onClose} />);
        const dialog = screen.getByRole('dialog', { name: 'The Mind' });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Context Highlighter' }));
        fireEvent.mouseUp(dialog);
        await screen.findByText('Capture Context', { exact: false });

        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
    });

    it('offers no Think in the preview: the button is there and disabled', () => {
        render(<MindPanel isOpen onClose={vi.fn()} />);
        expect((screen.getByRole('button', { name: /Think/ }) as HTMLButtonElement).disabled).toBe(true);
    });

    it('renders nothing when closed', () => {
        render(<MindPanel isOpen={false} onClose={vi.fn()} />);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});
