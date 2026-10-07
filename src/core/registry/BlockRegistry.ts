// ============================================
// PROJECT OMNI: BLOCK REGISTRY
// ============================================

import { OmniBlockSchema, BlockCategory } from '../schemas/block.schema';
import { createJsonOutputPort, createAnyInputPort, createTextOutputPort } from '../services/port.service';

/**
 * Registry of all available block types
 * New blocks are registered here to appear in the Armory
 */
class BlockRegistry {
    private blocks: Map<string, OmniBlockSchema> = new Map();

    /**
     * Register a new block type
     */
    register(schema: OmniBlockSchema): void {
        if (this.blocks.has(schema.block_id)) {
            console.warn(`Block ${schema.block_id} is already registered. Overwriting.`);
        }
        this.blocks.set(schema.block_id, schema);
    }

    /**
     * Get a block schema by ID
     */
    get(blockId: string): OmniBlockSchema | undefined {
        return this.blocks.get(blockId);
    }

    /**
     * Get all registered blocks
     */
    getAll(): OmniBlockSchema[] {
        return Array.from(this.blocks.values());
    }

    /**
     * Get blocks by category
     */
    getByCategory(category: BlockCategory): OmniBlockSchema[] {
        return this.getAll().filter(block => block.category === category);
    }

    /**
     * Search blocks by semantic tags or name
     */
    search(query: string): OmniBlockSchema[] {
        const lowerQuery = query.toLowerCase();
        return this.getAll().filter(block =>
            block.display_name.toLowerCase().includes(lowerQuery) ||
            block.semantic_tags.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
            block.description?.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Check if a block is registered
     */
    has(blockId: string): boolean {
        return this.blocks.has(blockId);
    }

    /**
     * Remove a block from the registry
     */
    unregister(blockId: string): boolean {
        return this.blocks.delete(blockId);
    }
}

// Singleton instance
export const blockRegistry = new BlockRegistry();

// ============================================
// REGISTER DEFAULT BLOCKS
// ============================================

// Polymarket Block
blockRegistry.register({
    block_id: 'polymarket_live_odds',
    display_name: 'Polymarket',
    category: 'truth',
    semantic_tags: ['prediction', 'truth_signal', 'market', 'probability', 'betting'],
    ports: [
        createJsonOutputPort('out', 'Market Data')
    ],
    icon: 'TrendingUp',
    description: 'Real-time prediction market odds and probabilities'
});

// CoinGecko Block
blockRegistry.register({
    block_id: 'coingecko_crypto',
    display_name: 'Crypto Markets',
    category: 'truth',
    semantic_tags: ['crypto', 'bitcoin', 'ethereum', 'prices', 'market'],
    icon: 'Coins',
    description: 'Live cryptocurrency prices and market data',
    ports: [
        createJsonOutputPort('out', 'Market Data')
    ]
});

// Hacker News Block
blockRegistry.register({
    block_id: 'hackernews_feed',
    display_name: 'Hacker News',
    category: 'pulse',
    semantic_tags: ['hackernews', 'tech', 'startups', 'programming', 'ycombinator'],
    icon: 'Zap',
    description: 'Top stories from Hacker News',
    ports: [
        createJsonOutputPort('out', 'Story Feed')
    ]
});

// OpenAlex Block
blockRegistry.register({
    block_id: 'openalex_works',
    display_name: 'OpenAlex',
    category: 'truth',
    semantic_tags: ['research', 'papers', 'citations', 'scholarly'],
    ports: [
        createJsonOutputPort('out', 'Research Feed')
    ],
    icon: 'BookOpen',
    description: 'Recent research works and citations'
});

// World Bank Block
blockRegistry.register({
    block_id: 'worldbank_indicator',
    display_name: 'World Bank',
    category: 'truth',
    semantic_tags: ['development', 'global', 'indicator', 'time series'],
    ports: [
        createJsonOutputPort('out', 'Indicator Data')
    ],
    icon: 'Globe',
    description: 'World Bank global development indicators'
});

blockRegistry.register({
    block_id: 'usgs_quakes',
    display_name: 'Earthquakes',
    category: 'physicality',
    semantic_tags: ['earthquake', 'usgs', 'hazards', 'geology'],
    ports: [
        createJsonOutputPort('out', 'Quake Feed')
    ],
    icon: 'Activity',
    description: 'USGS magnitude 4.5+ earthquakes this week'
});

blockRegistry.register({
    block_id: 'openmeteo_forecast',
    display_name: 'Weather',
    category: 'environment',
    semantic_tags: ['weather', 'forecast', 'climate', 'open-meteo'],
    ports: [
        createJsonOutputPort('out', 'Forecast')
    ],
    icon: 'CloudSun',
    description: 'Open-Meteo current conditions and daily forecast'
});

blockRegistry.register({
    block_id: 'frankfurter_fx',
    display_name: 'FX Rates',
    category: 'truth',
    semantic_tags: ['fx', 'currency', 'ecb', 'rates'],
    ports: [
        createJsonOutputPort('out', 'Rates')
    ],
    icon: 'DollarSign',
    description: 'ECB foreign-exchange reference rates'
});

blockRegistry.register({
    block_id: 'wikipedia_search',
    display_name: 'Wikipedia',
    category: 'pulse',
    semantic_tags: ['wikipedia', 'encyclopedia', 'knowledge'],
    ports: [
        createJsonOutputPort('out', 'Articles')
    ],
    icon: 'BookOpen',
    description: 'Live Wikipedia article search'
});

blockRegistry.register({
    block_id: 'openlibrary_search',
    display_name: 'Open Library',
    category: 'truth',
    semantic_tags: ['books', 'library', 'research'],
    ports: [
        createJsonOutputPort('out', 'Books')
    ],
    icon: 'Library',
    description: 'Books from the Internet Archive catalog'
});

blockRegistry.register({
    block_id: 'github_repos',
    display_name: 'GitHub',
    category: 'truth',
    semantic_tags: ['github', 'code', 'opensource', 'repos'],
    ports: [
        createJsonOutputPort('out', 'Repositories')
    ],
    icon: 'Github',
    description: 'Public GitHub repositories by stars'
});

blockRegistry.register({
    block_id: 'crossref_works',
    display_name: 'Crossref',
    category: 'truth',
    semantic_tags: ['research', 'doi', 'papers', 'citations'],
    ports: [
        createJsonOutputPort('out', 'Works')
    ],
    icon: 'Files',
    description: 'Scholarly works from Crossref — no API key'
});

// ============================================
// WORKSPACE BLOCKS
// ============================================

// Text Note Block
blockRegistry.register({
    block_id: 'text_note',
    display_name: 'Text Note',
    category: 'workspace',
    semantic_tags: ['notes', 'documents', 'research', 'writing', 'markdown'],
    ports: [
        createTextOutputPort('out', 'Text Content')
    ],
    icon: 'FileText',
    description: 'Markdown notes with preview toggle'
});

// ============================================
// PERSONA BLOCKS
// ============================================

// Analyst Persona
blockRegistry.register({
    block_id: 'persona_analyst',
    display_name: 'Analyst',
    category: 'model',
    semantic_tags: ['persona', 'ai', 'analyst', 'data', 'insights', 'intelligence'],
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Analysis')
    ],
    icon: 'Target',
    description: '🎯 Data-driven insights and market analysis'
});

// Strategist Persona
blockRegistry.register({
    block_id: 'persona_strategist',
    display_name: 'Strategist',
    category: 'model',
    semantic_tags: ['persona', 'ai', 'strategist', 'planning', 'tactics'],
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Strategy')
    ],
    icon: 'Swords',
    description: '⚔️ Long-term planning and tactical decisions'
});

// Researcher Persona
blockRegistry.register({
    block_id: 'persona_researcher',
    display_name: 'Researcher',
    category: 'model',
    semantic_tags: ['persona', 'ai', 'researcher', 'science', 'knowledge'],
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Research')
    ],
    icon: 'FlaskConical',
    description: '🔬 Deep investigation and knowledge synthesis'
});

// Creative Persona
blockRegistry.register({
    block_id: 'persona_creative',
    display_name: 'Creative',
    category: 'model',
    semantic_tags: ['persona', 'ai', 'creative', 'ideas', 'innovation'],
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Ideas')
    ],
    icon: 'Palette',
    description: '🎨 Ideation and unconventional thinking'
});

// Guardian Persona
blockRegistry.register({
    block_id: 'persona_guardian',
    display_name: 'Guardian',
    category: 'model',
    semantic_tags: ['persona', 'ai', 'guardian', 'risk', 'protection'],
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Risk Analysis')
    ],
    icon: 'Shield',
    description: '🛡️ Risk assessment and protective analysis'
});


// ============================================
// MEMORY BLOCKS
// A Mind pool made spatial. Wire one into a persona to give it recollection
// the same way you give it data — visibly, and cuttably.
// ============================================

blockRegistry.register({
    block_id: 'memory_pool',
    display_name: 'Memory',
    category: 'model',
    semantic_tags: ['memory', 'context', 'recall', 'mind', 'pool', 'notes'],
    ports: [
        createJsonOutputPort('out', 'Entries')
    ],
    icon: 'Brain',
    description: 'Recollection from a Mind pool, wired in like any other source'
});

