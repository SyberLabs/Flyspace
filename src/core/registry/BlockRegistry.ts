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
    data_type: 'probabilistic_stream',
    refresh_rate: '1s',
    semantic_tags: ['prediction', 'truth_signal', 'market', 'probability', 'betting'],
    wiring_logic: 'map_to_game_theory_agent',
    ports: [
        createJsonOutputPort('out', 'Market Data')
    ],
    icon: 'TrendingUp',
    description: 'Real-time prediction market odds and probabilities'
});

// NewsAPI Block
blockRegistry.register({
    block_id: 'newsapi_feed',
    display_name: 'News Feed',
    category: 'pulse',
    data_type: 'news_feed',
    refresh_rate: '5m',
    semantic_tags: ['news', 'narrative', 'sentiment', 'headlines', 'media'],
    wiring_logic: 'map_to_narrative_agent',
    ports: [
        createJsonOutputPort('out', 'Article Feed')
    ],
    icon: 'Newspaper',
    description: 'Aggregated news articles with sentiment analysis'
});

// CoinGecko Block
blockRegistry.register({
    block_id: 'coingecko_crypto',
    display_name: 'Crypto Markets',
    category: 'truth',
    data_type: 'financial',
    refresh_rate: '1m',
    semantic_tags: ['crypto', 'bitcoin', 'ethereum', 'prices', 'market'],
    wiring_logic: 'map_to_quant_agent',
    icon: 'Coins',
    description: 'Live cryptocurrency prices and market data',
    ports: [
        createJsonOutputPort('out', 'Market Data')
    ],
    isUserCreatable: true
});

// Alpha Vantage Block
blockRegistry.register({
    block_id: 'alpha_vantage_quote',
    display_name: 'Alpha Vantage',
    category: 'truth',
    data_type: 'financial',
    refresh_rate: '1m',
    semantic_tags: ['stocks', 'forex', 'crypto', 'market', 'quote'],
    wiring_logic: 'map_to_quant_agent',
    ports: [
        createJsonOutputPort('out', 'Market Quote')
    ],
    icon: 'LineChart',
    description: 'Market quote data from Alpha Vantage',
    isUserCreatable: true
});

// Hacker News Block
blockRegistry.register({
    block_id: 'hackernews_feed',
    display_name: 'Hacker News',
    category: 'pulse',
    data_type: 'news_feed',
    refresh_rate: '5m',
    semantic_tags: ['hackernews', 'tech', 'startups', 'programming', 'ycombinator'],
    wiring_logic: 'map_to_narrative_agent',
    icon: 'Zap',
    description: 'Top stories from Hacker News',
    ports: [
        createJsonOutputPort('out', 'Story Feed')
    ],
    isUserCreatable: true
});

// Metaculus Block
blockRegistry.register({
    block_id: 'metaculus_forecast',
    display_name: 'Metaculus Forecast',
    category: 'truth',
    data_type: 'probabilistic_stream',
    refresh_rate: '1m',
    semantic_tags: ['metaculus', 'forecasting', 'prediction', 'probability', 'science'],
    wiring_logic: 'map_to_game_theory_agent',
    ports: [
        createJsonOutputPort('out', 'Forecast Data')
    ],
    icon: 'Target',
    description: 'Scientific forecasting and prediction questions'
});

// OpenAlex Block
blockRegistry.register({
    block_id: 'openalex_works',
    display_name: 'OpenAlex',
    category: 'truth',
    data_type: 'news_feed',
    refresh_rate: '30m',
    semantic_tags: ['research', 'papers', 'citations', 'scholarly'],
    wiring_logic: 'map_to_research_agent',
    ports: [
        createJsonOutputPort('out', 'Research Feed')
    ],
    icon: 'BookOpen',
    description: 'Recent research works and citations',
    isUserCreatable: true
});

// FRED Block
blockRegistry.register({
    block_id: 'fred_series',
    display_name: 'FRED',
    category: 'truth',
    data_type: 'financial',
    refresh_rate: '15m',
    semantic_tags: ['economics', 'macro', 'time series', 'fred', 'fed'],
    wiring_logic: 'map_to_quant_agent',
    ports: [
        createJsonOutputPort('out', 'Series Data')
    ],
    icon: 'LineChart',
    description: 'Federal Reserve Economic Data series observations',
    isUserCreatable: true
});

// BLS Block
blockRegistry.register({
    block_id: 'bls_series',
    display_name: 'BLS',
    category: 'truth',
    data_type: 'financial',
    refresh_rate: '30m',
    semantic_tags: ['labor', 'employment', 'time series', 'statistics'],
    wiring_logic: 'map_to_quant_agent',
    ports: [
        createJsonOutputPort('out', 'Series Data')
    ],
    icon: 'LineChart',
    description: 'Bureau of Labor Statistics time series data',
    isUserCreatable: true
});

// World Bank Block
blockRegistry.register({
    block_id: 'worldbank_indicator',
    display_name: 'World Bank',
    category: 'truth',
    data_type: 'financial',
    refresh_rate: '1h',
    semantic_tags: ['development', 'global', 'indicator', 'time series'],
    wiring_logic: 'map_to_quant_agent',
    ports: [
        createJsonOutputPort('out', 'Indicator Data')
    ],
    icon: 'Globe',
    description: 'World Bank global development indicators',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'usgs_quakes',
    display_name: 'Earthquakes',
    category: 'physicality',
    data_type: 'telemetry',
    refresh_rate: '5m',
    semantic_tags: ['earthquake', 'usgs', 'hazards', 'geology'],
    wiring_logic: 'map_to_analyst_agent',
    ports: [
        createJsonOutputPort('out', 'Quake Feed')
    ],
    icon: 'Activity',
    description: 'USGS magnitude 4.5+ earthquakes this week',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'openmeteo_forecast',
    display_name: 'Weather',
    category: 'environment',
    data_type: 'telemetry',
    refresh_rate: '15m',
    semantic_tags: ['weather', 'forecast', 'climate', 'open-meteo'],
    wiring_logic: 'map_to_analyst_agent',
    ports: [
        createJsonOutputPort('out', 'Forecast')
    ],
    icon: 'CloudSun',
    description: 'Open-Meteo current conditions and daily forecast',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'frankfurter_fx',
    display_name: 'FX Rates',
    category: 'truth',
    data_type: 'financial',
    refresh_rate: '1h',
    semantic_tags: ['fx', 'currency', 'ecb', 'rates'],
    wiring_logic: 'map_to_quant_agent',
    ports: [
        createJsonOutputPort('out', 'Rates')
    ],
    icon: 'DollarSign',
    description: 'ECB foreign-exchange reference rates',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'wikipedia_search',
    display_name: 'Wikipedia',
    category: 'pulse',
    data_type: 'news_feed',
    refresh_rate: '10m',
    semantic_tags: ['wikipedia', 'encyclopedia', 'knowledge'],
    wiring_logic: 'map_to_research_agent',
    ports: [
        createJsonOutputPort('out', 'Articles')
    ],
    icon: 'BookOpen',
    description: 'Live Wikipedia article search',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'openlibrary_search',
    display_name: 'Open Library',
    category: 'truth',
    data_type: 'news_feed',
    refresh_rate: '10m',
    semantic_tags: ['books', 'library', 'research'],
    wiring_logic: 'map_to_research_agent',
    ports: [
        createJsonOutputPort('out', 'Books')
    ],
    icon: 'Library',
    description: 'Books from the Internet Archive catalog',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'github_repos',
    display_name: 'GitHub',
    category: 'truth',
    data_type: 'news_feed',
    refresh_rate: '10m',
    semantic_tags: ['github', 'code', 'opensource', 'repos'],
    wiring_logic: 'map_to_developer_agent',
    ports: [
        createJsonOutputPort('out', 'Repositories')
    ],
    icon: 'Github',
    description: 'Public GitHub repositories by stars',
    isUserCreatable: true
});

blockRegistry.register({
    block_id: 'crossref_works',
    display_name: 'Crossref',
    category: 'truth',
    data_type: 'news_feed',
    refresh_rate: '10m',
    semantic_tags: ['research', 'doi', 'papers', 'citations'],
    wiring_logic: 'map_to_research_agent',
    ports: [
        createJsonOutputPort('out', 'Works')
    ],
    icon: 'Files',
    description: 'Scholarly works from Crossref — no API key',
    isUserCreatable: true
});

// ============================================
// WORKSPACE BLOCKS
// ============================================

// Text Note Block
blockRegistry.register({
    block_id: 'text_note',
    display_name: 'Text Note',
    category: 'workspace',
    data_type: 'text',
    refresh_rate: 'manual',
    semantic_tags: ['notes', 'documents', 'research', 'writing', 'markdown'],
    wiring_logic: 'map_to_analyst_agent',
    ports: [
        createTextOutputPort('out', 'Text Content')
    ],
    icon: 'FileText',
    description: 'Markdown notes with preview toggle',
    expandMode: 'portal',
    isUserCreatable: true
});

// Code Block
blockRegistry.register({
    block_id: 'code_sandbox',
    display_name: 'Code',
    category: 'workspace',
    data_type: 'code',
    refresh_rate: 'manual',
    semantic_tags: ['code', 'programming', 'scripts', 'analysis', 'developer'],
    wiring_logic: 'map_to_developer_agent',
    icon: 'Code',
    description: 'Syntax-highlighted code display',
    expandMode: 'portal',
    isUserCreatable: true
});

// Media Block
blockRegistry.register({
    block_id: 'media_gallery',
    display_name: 'Media',
    category: 'workspace',
    data_type: 'media',
    refresh_rate: 'manual',
    semantic_tags: ['images', 'video', 'gallery', 'media', 'files'],
    wiring_logic: 'map_to_analyst_agent',
    icon: 'Image',
    description: 'Image and video gallery',
    expandMode: 'portal',
    isUserCreatable: true
});

// Embed Block
blockRegistry.register({
    block_id: 'web_embed',
    display_name: 'Web Embed',
    category: 'workspace',
    data_type: 'embed',
    refresh_rate: 'manual',
    semantic_tags: ['embed', 'iframe', 'website', 'external', 'browser'],
    wiring_logic: 'map_to_analyst_agent',
    icon: 'Globe',
    description: 'Embed external web content',
    expandMode: 'fullscreen',
    isUserCreatable: true
});

// ============================================
// PERSONA BLOCKS
// ============================================

// Analyst Persona
blockRegistry.register({
    block_id: 'persona_analyst',
    display_name: 'Analyst',
    category: 'model',
    data_type: 'conversation',
    refresh_rate: 'manual',
    semantic_tags: ['persona', 'ai', 'analyst', 'data', 'insights', 'intelligence'],
    wiring_logic: 'accepts_wire_input',
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Analysis')
    ],
    icon: 'Target',
    description: '🎯 Data-driven insights and market analysis',
    expandMode: 'portal',
    isUserCreatable: true
});

// Strategist Persona
blockRegistry.register({
    block_id: 'persona_strategist',
    display_name: 'Strategist',
    category: 'model',
    data_type: 'conversation',
    refresh_rate: 'manual',
    semantic_tags: ['persona', 'ai', 'strategist', 'planning', 'tactics'],
    wiring_logic: 'accepts_wire_input',
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Strategy')
    ],
    icon: 'Swords',
    description: '⚔️ Long-term planning and tactical decisions',
    expandMode: 'portal',
    isUserCreatable: true
});

// Researcher Persona
blockRegistry.register({
    block_id: 'persona_researcher',
    display_name: 'Researcher',
    category: 'model',
    data_type: 'conversation',
    refresh_rate: 'manual',
    semantic_tags: ['persona', 'ai', 'researcher', 'science', 'knowledge'],
    wiring_logic: 'accepts_wire_input',
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Research')
    ],
    icon: 'FlaskConical',
    description: '🔬 Deep investigation and knowledge synthesis',
    expandMode: 'portal',
    isUserCreatable: true
});

// Creative Persona
blockRegistry.register({
    block_id: 'persona_creative',
    display_name: 'Creative',
    category: 'model',
    data_type: 'conversation',
    refresh_rate: 'manual',
    semantic_tags: ['persona', 'ai', 'creative', 'ideas', 'innovation'],
    wiring_logic: 'accepts_wire_input',
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Ideas')
    ],
    icon: 'Palette',
    description: '🎨 Ideation and unconventional thinking',
    expandMode: 'portal',
    isUserCreatable: true
});

// Guardian Persona
blockRegistry.register({
    block_id: 'persona_guardian',
    display_name: 'Guardian',
    category: 'model',
    data_type: 'conversation',
    refresh_rate: 'manual',
    semantic_tags: ['persona', 'ai', 'guardian', 'risk', 'protection'],
    wiring_logic: 'accepts_wire_input',
    ports: [
        createAnyInputPort('in', 'Data Input'),
        createTextOutputPort('out', 'Risk Analysis')
    ],
    icon: 'Shield',
    description: '🛡️ Risk assessment and protective analysis',
    expandMode: 'portal',
    isUserCreatable: true
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
    data_type: 'custom',
    refresh_rate: 'manual',
    semantic_tags: ['memory', 'context', 'recall', 'mind', 'pool', 'notes'],
    wiring_logic: 'none',
    ports: [
        createJsonOutputPort('out', 'Entries')
    ],
    icon: 'Brain',
    description: 'Recollection from a Mind pool, wired in like any other source',
    expandMode: 'resize',
    isUserCreatable: true
});

export default blockRegistry;

