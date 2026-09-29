// WP-OMNI-04 — spoken capability composition.
// Speech proposes semantic commands. It does not invent coordinates.

import type { SpatialAction } from './types';

export interface SpeechIntent {
    action: SpatialAction;
    personaBlockId?: string;
    displayName?: string;
    targetName?: string;
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

function persona(name: string) {
    return PERSONAS[name.toLowerCase()];
}

/** Deterministic grammar for the spatial command set. Unknown speech is refused, not guessed. */
export function parseSpeech(transcript: string): SpeechIntent | null {
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

    if (text === 'compare these' || text === 'compare this') {
        return { action: 'compare', deixis: 'these', destructive: false };
    }
    if (text === 'connect this to that') {
        return { action: 'connect', deixis: 'these', destructive: false };
    }
    if (text === 'delete this' || text === 'remove this') {
        return { action: 'delete', deixis: 'this', destructive: true };
    }
    if (text === 'group these') {
        return { action: 'group', deixis: 'these', destructive: false };
    }
    if (text === 'keep these apart' || text === 'keep these separate') {
        return { action: 'separate', deixis: 'these', destructive: false };
    }
    if (text === 'branch from here') {
        return { action: 'branch', deixis: 'this', destructive: false };
    }
    if (text === 'remember this') {
        return { action: 'crystallize', deixis: 'this', destructive: false };
    }
    if (text === 'undo') return { action: 'undo', deixis: 'none', destructive: false };
    if (text === 'cancel') return { action: 'cancel', deixis: 'none', destructive: false };

    const namedCreate = text.match(/^create persona:(researcher|analyst|strategist|creative|guardian)(?: as \w+)?$/);
    if (namedCreate) {
        const kind = persona(namedCreate[1]);
        return {
            action: 'create',
            personaBlockId: kind.blockId,
            displayName: kind.displayName,
            deixis: 'none',
            destructive: false
        };
    }

    return null;
}
