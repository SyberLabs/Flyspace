// @vitest-environment happy-dom
// ============================================
// ShellPanel is a modal dialog: announced, Escape-closable, focused on open,
// and it never reaches for the browser's native confirm/prompt/alert.
// ============================================

import type { ReactNode, ComponentProps } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ShellPanel } from './ShellPanel';
import { useShellStore, useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';

// happy-dom cancels framer-motion's animations as an unhandled rejection.
// The mock keeps every DOM prop (role, aria-*, ref, handlers) and drops the
// motion-only ones, so what the test sees is what the browser gets.
vi.mock('framer-motion', () => ({
    motion: {
        div: ({ children, initial: _i, animate: _a, exit: _e, transition: _t, ...rest }:
            ComponentProps<'div'> & Record<'initial' | 'animate' | 'exit' | 'transition', unknown>) =>
            <div {...rest}>{children}</div>
    },
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>
}));

function seedShell(id = 'shell_a', name = 'Alpha') {
    useShellStore.setState({
        shells: [{
            id, name, description: '', type: 'custom',
            blocks: [], connections: [], persona: 'analyst', aesthetic: 'citadel',
            createdAt: Date.now(), updatedAt: Date.now(), version: '1.0.0'
        } as never],
        hotkeySlots: {}
    });
}

describe('ShellPanel a11y', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null, hotkeySlots: {} });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });
    // happy-dom ships no confirm/prompt/alert; stub them so a native call is observable.
    afterEach(() => vi.unstubAllGlobals());

    it('is a modal dialog labelled by its visible heading, and focus lands inside on open', () => {
        render(<ShellPanel isOpen onClose={vi.fn()} />);
        const dialog = screen.getByRole('dialog', { name: 'Shell Manager' });
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const heading = screen.getByRole('heading', { name: 'Shell Manager' });
        expect(dialog.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('names its icon-only close button and closes on Escape', () => {
        const onClose = vi.fn();
        render(<ShellPanel isOpen onClose={onClose} />);
        const dialog = screen.getByRole('dialog', { name: 'Shell Manager' });
        expect(within(dialog).getByRole('button', { name: 'Close Shell Manager' })).toBeTruthy();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('the Create dialog is its own labelled modal dialog; Escape cancels it, not the panel', () => {
        const onClose = vi.fn();
        render(<ShellPanel isOpen onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'New Shell' }));
        const create = screen.getByRole('dialog', { name: 'Create New Shell' });
        expect(create.getAttribute('aria-modal')).toBe('true');
        expect(within(create).getByLabelText('Shell Name')).toBeTruthy();
        expect(within(create).getByLabelText('Description (optional)')).toBeTruthy();
        fireEvent.keyDown(within(create).getByLabelText('Shell Name'), { key: 'Escape' });
        expect(screen.queryByRole('dialog', { name: 'Create New Shell' })).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('delete asks inline, never through window.confirm, and Cancel keeps the shell', () => {
        seedShell();
        const confirmSpy = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmSpy);
        render(<ShellPanel isOpen onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }));
        const ask = screen.getByRole('alertdialog', { name: /Delete Alpha\?/ });
        expect(ask.contains(document.activeElement)).toBe(true);
        expect(confirmSpy).not.toHaveBeenCalled();
        expect(useShellStore.getState().shells).toHaveLength(1);

        fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(useShellStore.getState().shells).toHaveLength(1);

        fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }));
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
        expect(useShellStore.getState().shells).toHaveLength(0);
        expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('Escape dismisses the inline delete confirmation without closing the panel', () => {
        seedShell();
        const onClose = vi.fn();
        render(<ShellPanel isOpen onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'Delete Alpha' }));
        fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
        expect(screen.queryByRole('alertdialog')).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('the hotkey slot is chosen with buttons, never through window.prompt or alert', () => {
        seedShell();
        const promptSpy = vi.fn(() => '3');
        const alertSpy = vi.fn();
        vi.stubGlobal('prompt', promptSpy);
        vi.stubGlobal('alert', alertSpy);
        render(<ShellPanel isOpen onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: 'Assign hotkey to Alpha' }));
        const picker = screen.getByRole('group', { name: 'Hotkey slot for Alpha' });
        expect(within(picker).getAllByRole('button', { name: /^Slot [1-9]$/ })).toHaveLength(9);
        expect(picker.contains(document.activeElement)).toBe(true);

        fireEvent.click(within(picker).getByRole('button', { name: 'Slot 3' }));
        expect(useShellStore.getState().hotkeySlots[3]).toBe('shell_a');
        expect(screen.queryByRole('group', { name: 'Hotkey slot for Alpha' })).toBeNull();
        expect(promptSpy).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
    });
});
