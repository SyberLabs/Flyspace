// WP-OMNI-04 — spoken capability composition.
// Speech proposes semantic commands. It does not invent coordinates.

import type { SpatialAction } from './types';

type SpeechCommandAction = SpatialAction | 'open-shell' | 'confirm';

interface SpeechBlockKind {
    blockId: string;
    displayName: string;
    aliases: string[];
}

export interface SpeechShellKind {
    id: string;
    name: string;
    kind: 'root' | 'template' | 'saved';
    aliases: string[];
}

export interface SpeechCatalog {
    blocks: SpeechBlockKind[];
    shells: SpeechShellKind[];
}

export interface SpeechIntent {
    action: SpeechCommandAction;
    personaBlockId?: string;
    displayName?: string;
    targetName?: string;
    sourceName?: string;
    shell?: SpeechShellKind;
    ambiguous?: 'block' | 'shell';
    deixis: 'this' | 'these' | 'here' | 'none';
    destructive: boolean;
}

const PERSONAS: Record<string, { blockId: string; displayName: string }> = {
    researcher: { blockId: 'persona_researcher', displayName: 'Researcher' },
    analyst: { blockId: 'persona_analyst', displayName: 'Analyst' },
    strategist: { blockId: 'persona_strategist', displayName: 'Strategist' },
    creative: { blockId: 'persona_creative', displayName: 'Creative' },
    guardian: { blockId: 'persona_guardian', displayName: 'Guardian' }
};

const BUILTIN_BLOCKS: SpeechBlockKind[] = Object.values(PERSONAS).map(kind => ({ ...kind, aliases: [kind.displayName.toLowerCase()] }));

export function defaultSpeechCatalog(): SpeechCatalog {
    return {
        blocks: BUILTIN_BLOCKS,
        shells: [
            { id: 'root', name: 'Root', kind: 'root', aliases: ['root', 'home', 'root shell'] }
        ]
    };
}

function words(value: string): string[] {
    return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function matchCatalog<T extends { aliases: string[] }>(query: string, items: T[]): T | 'ambiguous' | null {
    const needle = query.trim().toLowerCase();
    if (!needle) return null;
    const exact = items.filter(item => item.aliases.some(alias => alias === needle));
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return 'ambiguous';
    const partial = items.filter(item => item.aliases.some(alias => {
        const aliasWords = words(alias);
        const queryWords = words(needle);
        return queryWords.length > 0 && queryWords.every(word => aliasWords.includes(word));
    }));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) return 'ambiguous';
    return null;
}

function persona(name: string) {
    return PERSONAS[name.toLowerCase()];
}

/** Deterministic grammar for canvas control. Unknown speech is refused, not guessed. */
export function parseSpeech(transcript: string, catalog: SpeechCatalog = defaultSpeechCatalog()): SpeechIntent | null {
    const text = transcript.trim().toLowerCase().replace(/[.?!]+$/g, '');
    if (!text) return null;

    const create = text.match(/^create (?:a |an )?(researcher|analyst|strategist|creative|guardian)(?: as \w+)?$/);
    if (create) {
        const kind = persona(create[1]);
        return {
            action: 'create',
            personaBlockId: kind.blockId,
            displayName: kind.displayName,
            deixis: 'none',
            destructive: false
        };
    }

    const putHere = text.match(/^put (?:a |an )?(researcher|analyst|strategist|creative|guardian) here$/);
    if (putHere) {
        const kind = persona(putHere[1]);
        return {
            action: 'create',
            personaBlockId: kind.blockId,
            displayName: kind.displayName,
            deixis: 'here',
            destructive: false
        };
    }

    if (text === 'put this here' || text === 'put that there' || text === 'move this here') {
        return { action: 'move', deixis: 'here', destructive: false };
    }

    const give = text.match(/^give (?:this|these) to (?:the )?(researcher|analyst|strategist|creative|guardian)$/);
    if (give) {
        return {
            action: 'connect',
            targetName: give[1],
            deixis: text.includes('these') ? 'these' : 'this',
            destructive: false
        };
    }

    if (text === 'delete this' || text === 'remove this') {
        return { action: 'delete', deixis: 'this', destructive: true };
    }
    if (text === 'branch from here') {
        return { action: 'branch', deixis: 'this', destructive: false };
    }
    if (text === 'remember this') {
        return { action: 'crystallize', deixis: 'this', destructive: false };
    }
    if (text === 'undo') return { action: 'undo', deixis: 'none', destructive: false };
    if (text === 'cancel') return { action: 'cancel', deixis: 'none', destructive: false };
    if (text === 'confirm' || text === 'yes' || text === 'go ahead' || text === 'do it') {
        return { action: 'confirm', deixis: 'none', destructive: false };
    }

    const wire = text.match(/^(?:wire|connect) (.+) to (?:the )?(.+)$/);
    if (wire) {
        const source = wire[1].replace(/^(?:the )/, '');
        const target = wire[2];
        if (source === 'this' || source === 'these') {
            return {
                action: 'connect',
                targetName: target,
                deixis: source === 'these' ? 'these' : 'this',
                destructive: false
            };
        }
        return {
            action: 'connect',
            sourceName: source,
            targetName: target,
            deixis: 'none',
            destructive: false
        };
    }

    const opened = text.match(/^(?:open|go to|switch to) (?:the )?(.+)$/);
    if (opened) {
        const query = opened[1].replace(/ shell$/, '');
        const shell = matchCatalog(query, catalog.shells);
        if (shell === 'ambiguous') return { action: 'open-shell', ambiguous: 'shell', deixis: 'none', destructive: false };
        if (shell) return { action: 'open-shell', shell, deixis: 'none', destructive: false };
    }

    const added = text.match(/^(?:add|create|put) (?:a |an |the )?(.+)$/);
    if (added) {
        const here = added[1].endsWith(' here');
        const query = (here ? added[1].slice(0, -' here'.length) : added[1]).trim();
        const block = matchCatalog(query, catalog.blocks);
        if (block === 'ambiguous') {
            return { action: 'create', ambiguous: 'block', deixis: here ? 'here' : 'none', destructive: false };
        }
        if (block) {
            return {
                action: 'create',
                personaBlockId: block.blockId,
                displayName: block.displayName,
                deixis: here ? 'here' : 'none',
                destructive: false
            };
        }
    }

    const namedDelete = text.match(/^(?:delete|remove) (?:the )?(.+)$/);
    if (namedDelete && namedDelete[1] !== 'this') {
        return {
            action: 'delete',
            targetName: namedDelete[1],
            deixis: 'none',
            destructive: true
        };
    }

    return null;
}
