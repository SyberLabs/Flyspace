import { describe, it, expect } from 'vitest';
import { BLOCK_ICON_COMPONENTS, resolveBlockIcon } from './blockIcons';
import { API_CATALOG } from '@/core/schemas/api.schema';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { Activity } from 'lucide-react';

describe('block icons — every catalog API has a real UI icon', () => {
    it('maps every keyless block icon so Armory and the palette do not fall back', () => {
        const keylessBlocks = API_CATALOG
            .filter(p => !p.requiresAuth)
            .flatMap(p => p.blockIds ?? []);

        for (const blockId of keylessBlocks) {
            const schema = blockRegistry.get(blockId);
            expect(schema, blockId).toBeTruthy();
            expect(schema!.icon && schema!.icon in BLOCK_ICON_COMPONENTS, blockId).toBe(true);
        }
    });

    it('unknown names still resolve to Activity rather than throwing', () => {
        expect(resolveBlockIcon('NotARealIcon')).toBe(Activity);
        expect(resolveBlockIcon(undefined)).toBe(Activity);
    });
});
