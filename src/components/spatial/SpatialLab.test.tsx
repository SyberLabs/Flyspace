// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpatialLab } from './SpatialLab';
import { useBlockStore } from '@/core/stores';
import { spatialSession } from '@/core/interaction/session';

describe('SpatialLab', () => {
    beforeEach(() => {
        useBlockStore.setState({ blocks: [], activeShellId: 'root' });
    });

    it('places a researcher from a marked point and a spoken command', () => {
        render(<SpatialLab onClose={() => undefined} />);
        fireEvent.change(screen.getByLabelText('Spoken command'), { target: { value: 'create a researcher' } });
        fireEvent.click(screen.getByRole('button', { name: 'Run' }));
        expect(useBlockStore.getState().blocks.some(block => block.schema.block_id === 'persona_researcher')).toBe(true);
        expect(JSON.stringify(spatialSession.snapshot())).not.toContain('landmarks');
    });
});
