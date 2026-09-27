// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sidebar } from './Sidebar';
import { API_CATALOG } from '@/core/schemas/api.schema';
import { blockRegistry } from '@/core/registry/BlockRegistry';

describe('Armory — keyless demo blocks are on the shelf', () => {
    it('shows every keyless block without hunting empty life-system folders', () => {
        render(<Sidebar />);

        expect(screen.getByText('Block library')).toBeTruthy();
        expect(screen.queryByText('Health Blocks')).toBeNull();
        expect(screen.queryByText('Career Blocks')).toBeNull();

        for (const provider of API_CATALOG.filter(p => !p.requiresAuth)) {
            for (const blockId of provider.blockIds ?? []) {
                const schema = blockRegistry.get(blockId);
                expect(schema, blockId).toBeTruthy();
                expect(screen.getByText(schema!.display_name), schema!.display_name).toBeTruthy();
            }
        }
    });
});
