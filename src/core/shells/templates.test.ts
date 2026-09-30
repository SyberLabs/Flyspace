import { describe, it, expect } from 'vitest';
import {
    SHELL_TEMPLATES,
    getShellTemplate,
    validateTemplate,
    validateAllTemplates,
    keyedProvidersForTemplate,
    type ShellTemplate
} from './templates';
import { blockRegistry } from '@/core/registry/BlockRegistry';

const isRegistered = (id: string) => blockRegistry.has(id);

describe('SHELL_TEMPLATES integrity (against the real registry)', () => {
    it('has the Investor, Researcher, and World Watch shells', () => {
        expect(SHELL_TEMPLATES.map(t => t.id)).toEqual([
            'tmpl_investor',
            'tmpl_researcher',
            'tmpl_world_watch'
        ]);
        expect(getShellTemplate('tmpl_investor')).toBeDefined();
        expect(getShellTemplate('tmpl_researcher')).toBeDefined();
        expect(getShellTemplate('tmpl_world_watch')).toBeDefined();
    });

    it('every template references only registered block_ids and valid refs', () => {
        const problems = validateAllTemplates(isRegistered);
        // If this fails, a template names a block that does not exist in the
        // registry, or a connection points at a missing block.
        expect(problems).toEqual([]);
    });

    it('template ids are unique', () => {
        const ids = SHELL_TEMPLATES.map(t => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('keyedProvidersForTemplate — what a shell needs before it spawns', () => {
    it.each(SHELL_TEMPLATES.map(t => t.id))('%s needs zero keyed providers', (id) => {
        expect(keyedProvidersForTemplate(getShellTemplate(id)!)).toEqual([]);
    });

    it('a template containing a keyed block reports that provider', () => {
        const investor = getShellTemplate('tmpl_investor')!;
        const withFred: ShellTemplate = {
            ...investor,
            blocks: [
                ...investor.blocks,
                { ref: 'fred', blockId: 'fred_series', position: { x: 0, y: 0 } }
            ]
        };
        const keyed = keyedProvidersForTemplate(withFred);
        expect(keyed.map(p => p.id)).toEqual(['fred']);
        expect(keyed[0].envVar).toBe('FRED_API_KEY');
    });
});

describe('validateTemplate — catches authoring mistakes', () => {
    const base: ShellTemplate = {
        id: 'tmpl_test',
        name: 'Test',
        description: 'x',
        tags: [],
        blocks: [
            { ref: 'a', blockId: 'persona_analyst', position: { x: 0, y: 0 } },
            { ref: 'b', blockId: 'newsapi_feed', position: { x: 0, y: 0 } },
        ],
        connections: [{ sourceRef: 'b', targetRef: 'a' }],
    };

    it('passes a well-formed template', () => {
        expect(validateTemplate(base, isRegistered)).toEqual([]);
    });

    it('flags an unknown block_id', () => {
        const bad = { ...base, blocks: [{ ref: 'a', blockId: 'does_not_exist', position: { x: 0, y: 0 } }], connections: [] };
        const problems = validateTemplate(bad, isRegistered);
        expect(problems.some(p => p.includes('unknown block_id'))).toBe(true);
    });

    it('flags a connection referencing a missing block', () => {
        const bad = { ...base, connections: [{ sourceRef: 'ghost', targetRef: 'a' }] };
        const problems = validateTemplate(bad, isRegistered);
        expect(problems.some(p => p.includes("sourceRef 'ghost'"))).toBe(true);
    });

    it('flags duplicate block refs', () => {
        const bad = {
            ...base,
            blocks: [
                { ref: 'a', blockId: 'persona_analyst', position: { x: 0, y: 0 } },
                { ref: 'a', blockId: 'newsapi_feed', position: { x: 0, y: 0 } },
            ],
            connections: [],
        };
        const problems = validateTemplate(bad, isRegistered);
        expect(problems.some(p => p.includes('duplicate block ref'))).toBe(true);
    });
});
