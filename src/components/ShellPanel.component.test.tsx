// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShellPanel } from './ShellPanel';
import { useShellStore, useBlockStore } from '@/core/stores';
import { useWireStore } from '@/core/stores/wireStore';
import { getShellTemplate } from '@/core/shells/templates';

describe('ShellPanel — Shell Store wiring (real stores)', () => {
    beforeEach(() => {
        useShellStore.setState({ shells: [], activeShellId: null });
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
        useWireStore.setState({ wires: [] } as never);
    });

    it('shows the Shell Store with the Investor, Researcher, and World Watch cards', () => {
        render(<ShellPanel isOpen onClose={vi.fn()} />);
        expect(screen.getByText('Shell Store')).toBeTruthy();
        expect(screen.getByText('Investor Shell')).toBeTruthy();
        expect(screen.getByText('Researcher Shell')).toBeTruthy();
        expect(screen.getByText('World Watch')).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Use this shell' })).toHaveLength(3);
        expect(screen.getAllByText('Works without API keys').length).toBeGreaterThanOrEqual(3);
    });

    it('"Use this shell" spawns a fully wired shell and closes the panel', () => {
        const onClose = vi.fn();
        render(<ShellPanel isOpen onClose={onClose} />);

        fireEvent.click(screen.getAllByRole('button', { name: 'Use this shell' })[0]);

        // Panel closes; a new shell is registered and ACTIVE on the canvas…
        expect(onClose).toHaveBeenCalled();
        const shellId = useBlockStore.getState().activeShellId;
        expect(shellId).not.toBe('root');

        // …with every template block created…
        const investor = getShellTemplate('tmpl_investor')!;
        expect(useBlockStore.getState().getBlocksByShell(shellId)).toHaveLength(investor.blocks.length);

        // …and LIVE wires in the single wire system (the A1 regression, at UI level).
        expect(useWireStore.getState().getWiresByShell(shellId)).toHaveLength(investor.connections.length);
    });

    it('"Save Current" is disabled on the root canvas, which is not a shell', () => {
        render(<ShellPanel isOpen onClose={vi.fn()} />);
        const save = screen.getByRole('button', { name: 'Save Current' }) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        fireEvent.click(save);
        expect(useShellStore.getState().shells).toHaveLength(0);
    });

    it('"Save Current" snapshots the live canvas into the shell the user is on', () => {
        const investor = getShellTemplate('tmpl_investor')!;
        const shellId = useShellStore.getState().instantiateTemplate(investor)!;
        const blocks = useBlockStore.getState().getBlocksByShell(shellId);
        const analyst = blocks.find(b => b.schema.block_id === 'persona_analyst')!;
        useBlockStore.getState().updatePosition(analyst.instance_id, { x: 55, y: 66 });
        useBlockStore.getState().updateData(analyst.instance_id, { messages: [{ id: 'm1', role: 'user', content: 'hi' }] });

        render(<ShellPanel isOpen onClose={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Save Current' }));

        // The dialog opens on the shell's own name, so Save without edits keeps it.
        const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
        expect(nameInput.value).toBe(investor.name);
        fireEvent.change(nameInput, { target: { value: 'My Investor' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        // Still one record, under the same id, now holding what is on the canvas.
        const shells = useShellStore.getState().shells;
        expect(shells).toHaveLength(1);
        expect(shells[0].id).toBe(shellId);
        expect(shells[0].name).toBe('My Investor');
        const saved = shells[0].blocks.find(b => b.instanceId === analyst.instance_id)!;
        expect(saved.position).toEqual({ x: 55, y: 66 });
        expect((saved.config?.data as { messages: unknown[] }).messages).toHaveLength(1);
        expect(shells[0].blocks).toHaveLength(investor.blocks.length);
        expect(useBlockStore.getState().activeShellId).toBe(shellId);
    });
});
