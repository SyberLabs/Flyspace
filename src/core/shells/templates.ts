// ============================================
// PROJECT OMNI: SHELL TEMPLATES
// Code-defined, built-in shell templates for the Shell Store.
// Each template is an opinionated, preconfigured thinking environment that
// instantiates into a fresh shell. Templates reference registry block_ids and
// use *placeholder* instance ids that are remapped to fresh ids on instantiate.
// ============================================

import type { PersonaType, AestheticTheme } from '@/core/schemas/shell.schema';
import { API_CATALOG, type ApiProvider } from '@/core/schemas/api.schema';

/** A block placement inside a template (placeholder instanceId, remapped on use). */
export interface TemplateBlock {
    /** Local placeholder id, unique within the template; remapped on instantiate. */
    ref: string;
    /** Registry block_id this placement instantiates. */
    blockId: string;
    position: { x: number; y: number };
    dimensions?: { width: number; height: number };
    /** Fetch knobs copied onto the spawned BlockInstance. */
    params?: Record<string, unknown>;
}

/** A wire between two template blocks, by their local `ref`s. */
export interface TemplateConnection {
    sourceRef: string;
    targetRef: string;
}

/** A built-in shell template. */
export interface ShellTemplate {
    id: string;
    name: string;
    description: string;
    tags: string[];
    persona: PersonaType;
    aesthetic: AestheticTheme;
    blocks: TemplateBlock[];
    connections: TemplateConnection[];
}

// ============================================
// INVESTOR SHELL
// Keyless markets + signals wired into Analyst → Strategist.
// All block_ids below are registered in BlockRegistry.ts.
// ============================================

const INVESTOR_SHELL: ShellTemplate = {
    id: 'tmpl_investor',
    name: 'Investor Shell',
    description:
        'Prediction markets, crypto, US GDP growth, and tech signals wired into an ' +
        'Analyst and Strategist — a ready-made environment that works without API keys.',
    tags: ['finance', 'markets', 'macro'],
    persona: 'analyst',
    aesthetic: 'command',
    blocks: [
        // --- Markets (left column) ---
        { ref: 'polymarket', blockId: 'polymarket_live_odds', position: { x: 40, y: 40 } },
        { ref: 'crypto', blockId: 'coingecko_crypto', position: { x: 40, y: 320 } },
        // --- Context (middle column) ---
        { ref: 'worldbank', blockId: 'worldbank_indicator', position: { x: 420, y: 40 }, params: { indicator: 'NY.GDP.MKTP.KD.ZG', country: 'USA' } },
        { ref: 'hn', blockId: 'hackernews_feed', position: { x: 420, y: 320 } },
        // --- Personas (right column) ---
        { ref: 'analyst', blockId: 'persona_analyst', position: { x: 800, y: 120 } },
        { ref: 'strategist', blockId: 'persona_strategist', position: { x: 800, y: 560 } },
    ],
    connections: [
        { sourceRef: 'polymarket', targetRef: 'analyst' },
        { sourceRef: 'crypto', targetRef: 'analyst' },
        { sourceRef: 'worldbank', targetRef: 'analyst' },
        { sourceRef: 'hn', targetRef: 'analyst' },
        { sourceRef: 'analyst', targetRef: 'strategist' },
    ],
};

// ============================================
// RESEARCHER SHELL
// Keyless papers + tech signal + prediction markets into a Researcher,
// with Memory on the canvas so recollection is a wire, not a hidden toggle.
// ============================================

const RESEARCHER_SHELL: ShellTemplate = {
    id: 'tmpl_researcher',
    name: 'Researcher Shell',
    description:
        'OpenAlex papers on foundation models, Hacker News, and live prediction markets ' +
        'wired into a Researcher with Memory — works without API keys.',
    tags: ['research', 'papers', 'tech'],
    persona: 'researcher',
    aesthetic: 'journal',
    blocks: [
        { ref: 'openalex', blockId: 'openalex_works', position: { x: 40, y: 40 }, params: { search: 'foundation models' } },
        { ref: 'hn', blockId: 'hackernews_feed', position: { x: 40, y: 320 } },
        { ref: 'polymarket', blockId: 'polymarket_live_odds', position: { x: 420, y: 40 } },
        { ref: 'memory', blockId: 'memory_pool', position: { x: 420, y: 320 } },
        { ref: 'researcher', blockId: 'persona_researcher', position: { x: 800, y: 180 } },
    ],
    connections: [
        { sourceRef: 'openalex', targetRef: 'researcher' },
        { sourceRef: 'hn', targetRef: 'researcher' },
        { sourceRef: 'polymarket', targetRef: 'researcher' },
        { sourceRef: 'memory', targetRef: 'researcher' },
    ],
};

// ============================================
// WORLD WATCH SHELL
// The remaining keyless connectors on one canvas — weather, quakes,
// Wikipedia, FX, GitHub — so a demo does not depend on markets alone.
// ============================================

const WORLD_WATCH_SHELL: ShellTemplate = {
    id: 'tmpl_world_watch',
    name: 'World Watch',
    description:
        'Live weather, earthquakes, Wikipedia, ECB FX, and GitHub wired into an ' +
        'Analyst — every block works with nothing in .env.',
    tags: ['demo', 'live', 'keyless'],
    persona: 'analyst',
    aesthetic: 'command',
    blocks: [
        { ref: 'weather', blockId: 'openmeteo_forecast', position: { x: 40, y: 40 }, params: { latitude: 40.71, longitude: -74.01 } },
        { ref: 'quakes', blockId: 'usgs_quakes', position: { x: 40, y: 320 } },
        { ref: 'wiki', blockId: 'wikipedia_search', position: { x: 420, y: 40 }, params: { srsearch: 'artificial intelligence' } },
        { ref: 'fx', blockId: 'frankfurter_fx', position: { x: 420, y: 320 } },
        { ref: 'github', blockId: 'github_repos', position: { x: 800, y: 40 }, params: { q: 'stars:>10000' } },
        { ref: 'analyst', blockId: 'persona_analyst', position: { x: 800, y: 360 } },
    ],
    connections: [
        { sourceRef: 'weather', targetRef: 'analyst' },
        { sourceRef: 'quakes', targetRef: 'analyst' },
        { sourceRef: 'wiki', targetRef: 'analyst' },
        { sourceRef: 'fx', targetRef: 'analyst' },
        { sourceRef: 'github', targetRef: 'analyst' },
    ],
};

// ============================================
// REGISTRY
// ============================================

/** All built-in shell templates, in display order. */
export const SHELL_TEMPLATES: ShellTemplate[] = [
    INVESTOR_SHELL,
    RESEARCHER_SHELL,
    WORLD_WATCH_SHELL,
];

/** Look up a template by id. */
export function getShellTemplate(id: string): ShellTemplate | undefined {
    return SHELL_TEMPLATES.find(t => t.id === id);
}

/**
 * Providers a template will ask for a key. Derived from catalog blockIds so
 * a shell can say, before spawning, whether it works on a fresh clone.
 */
export function keyedProvidersForTemplate(template: ShellTemplate): ApiProvider[] {
    const blockIds = new Set(template.blocks.map(b => b.blockId));
    return API_CATALOG.filter(
        p => p.requiresAuth && p.blockIds?.some(id => blockIds.has(id))
    );
}

/**
 * Validate a template's internal integrity against a registry-membership check.
 * Returns the list of problems (empty = valid). Decoupled from the registry import
 * so it's trivially testable.
 *
 * Checks:
 *  - every block's `blockId` is a registered block (`isRegistered`)
 *  - block `ref`s are unique within the template
 *  - every connection's source/target ref exists in the template's blocks
 */
export function validateTemplate(
    template: ShellTemplate,
    isRegistered: (blockId: string) => boolean
): string[] {
    const problems: string[] = [];
    const refs = new Set<string>();

    for (const block of template.blocks) {
        if (refs.has(block.ref)) {
            problems.push(`[${template.id}] duplicate block ref '${block.ref}'`);
        }
        refs.add(block.ref);
        if (!isRegistered(block.blockId)) {
            problems.push(`[${template.id}] unknown block_id '${block.blockId}' (ref '${block.ref}')`);
        }
    }

    for (const conn of template.connections) {
        if (!refs.has(conn.sourceRef)) {
            problems.push(`[${template.id}] connection sourceRef '${conn.sourceRef}' not in blocks`);
        }
        if (!refs.has(conn.targetRef)) {
            problems.push(`[${template.id}] connection targetRef '${conn.targetRef}' not in blocks`);
        }
    }

    return problems;
}

/** Validate every built-in template. Returns all problems across templates. */
export function validateAllTemplates(isRegistered: (blockId: string) => boolean): string[] {
    return SHELL_TEMPLATES.flatMap(t => validateTemplate(t, isRegistered));
}
