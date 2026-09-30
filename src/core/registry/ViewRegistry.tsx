import React, { useState } from 'react';
import { PolymarketView } from '@/components/blocks/PolymarketView';
import { NewsView } from '@/components/blocks/NewsView';
import { CryptoView } from '@/components/blocks/CryptoView';
import { HNView } from '@/components/blocks/HNView';
import { MetaculusView } from '@/components/blocks/MetaculusView';
import { AlphaVantageView } from '@/components/blocks/AlphaVantageView';
import { OpenAlexView } from '@/components/blocks/OpenAlexView';
import { FredView } from '@/components/blocks/FredView';
import { BlsView } from '@/components/blocks/BlsView';
import { WorldBankView } from '@/components/blocks/WorldBankView';
import { OmniFeedView } from '@/components/blocks/OmniFeedView';
import { usePolymarketBlock } from '@/blocks/truth/PolymarketBlock';
import { useNewsBlock } from '@/blocks/truth/NewsApiBlock';
import { useCoinGeckoBlock } from '@/blocks/truth/CoinGeckoBlock';
import { useHackerNewsBlock } from '@/blocks/truth/HackerNewsBlock';
import { useMetaculusBlock } from '@/blocks/truth/MetaculusBlock';
import { useAlphaVantageBlock } from '@/blocks/truth/AlphaVantageBlock';
import { useOpenAlexBlock } from '@/blocks/truth/OpenAlexBlock';
import { useFredBlock } from '@/blocks/truth/FredBlock';
import { useBlsBlock } from '@/blocks/truth/BlsBlock';
import { useWorldBankBlock } from '@/blocks/truth/WorldBankBlock';
import { useOmniFeedBlock } from '@/blocks/truth/OmniFeedBlock';
import { API_CATALOG } from '@/core/schemas/api.schema';
import { TextBlockView, CodeBlockView } from '@/blocks/workspace';
import { PersonaBlockView } from '@/blocks/persona';
import { MemoryBlockView } from '@/components/blocks/MemoryBlock';
import { CapabilityBlockView } from '@/blocks/capability/CapabilityBlock';
import { SpeechBlockView } from '@/blocks/capability/SpeechBlock';
import { useBlockStore } from '@/core/stores';

function storedParams(instanceId: string): Record<string, unknown> | undefined {
    return useBlockStore.getState().getBlock(instanceId)?.params;
}

// ============================================
// BLOCK WRAPPERS
// Connects Hooks (Logic) to Views (UI)
// ============================================

function PolymarketBlockContent({ instanceId }: { instanceId: string }) {
    const { markets, status, lastUpdated, refresh, pause, resume, error } = usePolymarketBlock(instanceId);
    const [isPaused, setIsPaused] = useState(false);

    const handlePause = () => {
        pause();
        setIsPaused(true);
    };

    const handleResume = () => {
        resume();
        setIsPaused(false);
    };

    return (
        <PolymarketView
            markets={markets}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            onPause={handlePause}
            onResume={handleResume}
            isPaused={isPaused}
            error={error}
        />
    );
}

function NewsBlockContent({ instanceId }: { instanceId: string }) {
    const stored = useBlockStore(s => s.getBlock(instanceId)?.params);
    const query = typeof stored?.query === 'string' ? stored.query : undefined;
    const category = typeof stored?.category === 'string' ? stored.category : undefined;
    const { articles, status, lastUpdated, refresh, error } = useNewsBlock(instanceId, query, category);

    return (
        <NewsView
            articles={articles}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            error={error}
        />
    );
}

function CryptoBlockContent({ instanceId }: { instanceId: string }) {
    const { assets, status, lastUpdated, refresh, error } = useCoinGeckoBlock(instanceId);

    return (
        <CryptoView
            assets={assets}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            error={error}
        />
    );
}

function HNBlockContent({ instanceId }: { instanceId: string }) {
    const { stories, status, lastUpdated, refresh, error } = useHackerNewsBlock(instanceId);

    return (
        <HNView
            stories={stories}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            error={error}
        />
    );
}

function MetaculusBlockContent({ instanceId }: { instanceId: string }) {
    const { questions, status, lastUpdated, refresh, error } = useMetaculusBlock(instanceId);

    return (
        <MetaculusView
            questions={questions}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            error={error}
        />
    );
}

function AlphaVantageBlockContent({ instanceId }: { instanceId: string }) {
    const persistParams = useBlockStore(s => s.setParams);
    const defaultSymbol = 'AAPL';
    const initial = storedParams(instanceId);
    const initialSymbol = typeof initial?.symbol === 'string' ? initial.symbol : defaultSymbol;
    const [symbolInput, setSymbolInput] = useState(initialSymbol);
    const [params, setParams] = useState<{ symbol: string }>({ symbol: initialSymbol });
    const { items, metrics, status, lastUpdated, refresh, error } = useAlphaVantageBlock(instanceId, params);

    const handleApplySymbol = () => {
        const nextSymbol = symbolInput.trim().toUpperCase();
        if (!nextSymbol) return;
        const next = { ...params, symbol: nextSymbol };
        if (params.symbol === nextSymbol) return;
        setParams(next);
        persistParams(instanceId, next);
    };

    return (
        <AlphaVantageView
            items={items}
            metrics={metrics}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            symbolInput={symbolInput}
            onSymbolInputChange={setSymbolInput}
            onApplySymbol={handleApplySymbol}
            error={error}
        />
    );
}

function OpenAlexBlockContent({ instanceId }: { instanceId: string }) {
    const persistParams = useBlockStore(s => s.setParams);
    const initial = storedParams(instanceId);
    const [draft, setDraft] = useState({
        search: typeof initial?.search === 'string' ? initial.search : '',
        topic: typeof initial?.topic === 'string' ? initial.topic : '',
        year: typeof initial?.year === 'string' ? initial.year : ''
    });
    const [params, setParams] = useState<Record<string, unknown>>(initial ?? {});
    const { items, status, lastUpdated, refresh, error } = useOpenAlexBlock(instanceId, params);

    const handleApplyFilters = () => {
        const filters: string[] = [];
        let search = draft.search.trim();
        const topic = draft.topic.trim();
        const year = draft.year.trim();

        if (year && /^\d{4}$/.test(year)) {
            filters.push(`publication_year:${year}`);
        }

        if (topic) {
            const match = topic.match(/([CT]\d+)/i);
            if (match) {
                const id = match[1].toUpperCase();
                if (id.startsWith('T')) {
                    filters.push(`primary_topic.id:${id}`);
                } else if (id.startsWith('C')) {
                    filters.push(`concepts.id:${id}`);
                }
            } else {
                search = search ? `${search} ${topic}` : topic;
            }
        }

        const nextParams: Record<string, unknown> = {};
        if (search) nextParams.search = search;
        if (filters.length) nextParams.filter = filters.join(',');

        setParams(nextParams);
        persistParams(instanceId, {
            search: search || undefined,
            filter: filters.length ? filters.join(',') : undefined,
            topic: topic || undefined,
            year: year || undefined
        });
    };

    return (
        <OpenAlexView
            items={items}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            searchInput={draft.search}
            topicInput={draft.topic}
            yearInput={draft.year}
            onSearchInputChange={(value) => setDraft(prev => ({ ...prev, search: value }))}
            onTopicInputChange={(value) => setDraft(prev => ({ ...prev, topic: value }))}
            onYearInputChange={(value) => setDraft(prev => ({ ...prev, year: value }))}
            onApplyFilters={handleApplyFilters}
            error={error}
        />
    );
}

function FredBlockContent({ instanceId }: { instanceId: string }) {
    const persistParams = useBlockStore(s => s.setParams);
    const defaultSeries = 'GDP';
    const initial = storedParams(instanceId);
    const initialSeries = typeof initial?.seriesId === 'string' ? initial.seriesId : defaultSeries;
    const [seriesInput, setSeriesInput] = useState(initialSeries);
    const [params, setParams] = useState<{ seriesId: string; limit: number; sort_order: string }>({
        seriesId: initialSeries,
        limit: typeof initial?.limit === 'number' ? initial.limit : 24,
        sort_order: typeof initial?.sort_order === 'string' ? initial.sort_order : 'desc'
    });
    const { items, metrics, status, lastUpdated, refresh, error } = useFredBlock(instanceId, params);

    const handleApplySeries = () => {
        const nextSeries = seriesInput.trim().toUpperCase();
        if (!nextSeries) return;
        if (params.seriesId === nextSeries) return;
        const next = { ...params, seriesId: nextSeries };
        setParams(next);
        persistParams(instanceId, next);
    };

    return (
        <FredView
            items={items}
            metrics={metrics}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            seriesInput={seriesInput}
            onSeriesInputChange={setSeriesInput}
            onApplySeries={handleApplySeries}
            error={error}
        />
    );
}

function BlsBlockContent({ instanceId }: { instanceId: string }) {
    const persistParams = useBlockStore(s => s.setParams);
    const currentYear = new Date().getFullYear();
    const defaultStart = String(currentYear - 5);
    const defaultEnd = String(currentYear);
    const initial = storedParams(instanceId);
    const [draft, setDraft] = useState({
        seriesId: typeof initial?.seriesId === 'string' ? initial.seriesId : 'LNS14000000',
        startYear: typeof initial?.startYear === 'string' ? initial.startYear : defaultStart,
        endYear: typeof initial?.endYear === 'string' ? initial.endYear : defaultEnd
    });
    const [params, setParams] = useState({
        seriesId: typeof initial?.seriesId === 'string' ? initial.seriesId : 'LNS14000000',
        startYear: typeof initial?.startYear === 'string' ? initial.startYear : defaultStart,
        endYear: typeof initial?.endYear === 'string' ? initial.endYear : defaultEnd
    });
    const { items, metrics, status, lastUpdated, refresh, error } = useBlsBlock(instanceId, params);

    const normalizeYear = (value: string, fallback: string) => {
        const trimmed = value.trim();
        return /^\d{4}$/.test(trimmed) ? trimmed : fallback;
    };

    const handleApplySeries = () => {
        const seriesId = draft.seriesId.trim().toUpperCase();
        if (!seriesId) return;

        const startYear = normalizeYear(draft.startYear, defaultStart);
        const endYear = normalizeYear(draft.endYear, defaultEnd);

        const next = { seriesId, startYear, endYear };
        setParams(next);
        persistParams(instanceId, next);
    };

    return (
        <BlsView
            items={items}
            metrics={metrics}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            seriesInput={draft.seriesId}
            startYearInput={draft.startYear}
            endYearInput={draft.endYear}
            onSeriesInputChange={(value) => setDraft(prev => ({ ...prev, seriesId: value }))}
            onStartYearInputChange={(value) => setDraft(prev => ({ ...prev, startYear: value }))}
            onEndYearInputChange={(value) => setDraft(prev => ({ ...prev, endYear: value }))}
            onApplySeries={handleApplySeries}
            error={error}
        />
    );
}

function WorldBankBlockContent({ instanceId }: { instanceId: string }) {
    type WorldBankParams = {
        indicator: string;
        country: string;
        per_page: number;
        startYear?: string;
        endYear?: string;
    };

    const persistParams = useBlockStore(s => s.setParams);
    const initial = storedParams(instanceId);
    const [draft, setDraft] = useState({
        indicator: typeof initial?.indicator === 'string' ? initial.indicator : 'NY.GDP.MKTP.CD',
        country: typeof initial?.country === 'string' ? initial.country : 'USA',
        startYear: typeof initial?.startYear === 'string' ? initial.startYear : '',
        endYear: typeof initial?.endYear === 'string' ? initial.endYear : ''
    });
    const [params, setParams] = useState<WorldBankParams>({
        indicator: typeof initial?.indicator === 'string' ? initial.indicator : 'NY.GDP.MKTP.CD',
        country: typeof initial?.country === 'string' ? initial.country : 'USA',
        per_page: typeof initial?.per_page === 'number' ? initial.per_page : 60,
        ...(typeof initial?.startYear === 'string' ? { startYear: initial.startYear } : {}),
        ...(typeof initial?.endYear === 'string' ? { endYear: initial.endYear } : {})
    });
    const { items, metrics, status, lastUpdated, refresh, error } = useWorldBankBlock(instanceId, params);

    const normalizeYear = (value: string) => {
        const trimmed = value.trim();
        return /^\d{4}$/.test(trimmed) ? trimmed : '';
    };

    const handleApplyIndicator = () => {
        const indicator = draft.indicator.trim() || 'NY.GDP.MKTP.CD';
        const countryRaw = draft.country.trim();
        const country = countryRaw.toLowerCase() === 'all'
            ? 'all'
            : countryRaw.toUpperCase() || 'USA';
        const startYear = normalizeYear(draft.startYear);
        const endYear = normalizeYear(draft.endYear);

        const nextParams: WorldBankParams = {
            indicator,
            country,
            per_page: 60
        };
        if (startYear) nextParams.startYear = startYear;
        if (endYear) nextParams.endYear = endYear;

        setParams(nextParams);
        persistParams(instanceId, {
            ...nextParams,
            startYear: startYear || undefined,
            endYear: endYear || undefined
        });
    };

    return (
        <WorldBankView
            items={items}
            metrics={metrics}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            indicatorInput={draft.indicator}
            countryInput={draft.country}
            startYearInput={draft.startYear}
            endYearInput={draft.endYear}
            onIndicatorInputChange={(value) => setDraft(prev => ({ ...prev, indicator: value }))}
            onCountryInputChange={(value) => setDraft(prev => ({ ...prev, country: value }))}
            onStartYearInputChange={(value) => setDraft(prev => ({ ...prev, startYear: value }))}
            onEndYearInputChange={(value) => setDraft(prev => ({ ...prev, endYear: value }))}
            onApplyIndicator={handleApplyIndicator}
            error={error}
        />
    );
}

function providerForBlock(blockId: string) {
    return API_CATALOG.find(p => p.blockIds?.includes(blockId));
}

function OmniFeedBlockContent({ instanceId }: { instanceId: string }) {
    const persistParams = useBlockStore(s => s.setParams);
    const block = useBlockStore(s => s.getBlock(instanceId));
    const provider = providerForBlock(block?.schema.block_id ?? '');
    const gateway = provider?.integration?.gateway;
    const searchParam = gateway?.type === 'rest_list' ? gateway.config.searchParam : undefined;
    const defaults = gateway?.type === 'rest_list'
        ? gateway.config.defaultParams
        : gateway?.type === 'normalizer'
            ? gateway.defaultParams
            : undefined;
    const initial = storedParams(instanceId) ?? {};
    const initialSearch = searchParam && typeof initial[searchParam] === 'string'
        ? String(initial[searchParam])
        : searchParam && defaults && typeof defaults[searchParam] === 'string'
            ? String(defaults[searchParam])
            : '';
    const [draft, setDraft] = useState(initialSearch);
    const [params, setParams] = useState<Record<string, unknown>>({
        ...(defaults || {}),
        ...initial
    });
    const { items, status, lastUpdated, refresh, error } = useOmniFeedBlock(
        instanceId,
        provider?.id ?? '',
        params
    );

    const handleApplySearch = () => {
        if (!searchParam) return;
        const next = { ...params, [searchParam]: draft.trim() };
        setParams(next);
        persistParams(instanceId, next);
    };

    return (
        <OmniFeedView
            name={provider?.name ?? 'Feed'}
            items={items}
            status={status}
            lastUpdated={lastUpdated ?? null}
            onRefresh={refresh}
            error={error}
            searchValue={searchParam ? draft : undefined}
            searchPlaceholder={searchParam ? `Search ${provider?.name ?? ''}` : undefined}
            onSearchChange={searchParam ? setDraft : undefined}
            onApplySearch={searchParam ? handleApplySearch : undefined}
        />
    );
}

// ============================================
// VIEW REGISTRY
// ============================================

export const BlockViews: Record<string, React.ComponentType<{ instanceId: string }>> = {
    // Truth Blocks
    'polymarket_live_odds': PolymarketBlockContent,
    'newsapi_feed': NewsBlockContent,
    'coingecko_crypto': CryptoBlockContent,
    'hackernews_feed': HNBlockContent,
    'metaculus_forecast': MetaculusBlockContent,
    'alpha_vantage_quote': AlphaVantageBlockContent,
    'openalex_works': OpenAlexBlockContent,
    'fred_series': FredBlockContent,
    'bls_series': BlsBlockContent,
    'worldbank_indicator': WorldBankBlockContent,
    'usgs_quakes': OmniFeedBlockContent,
    'openmeteo_forecast': OmniFeedBlockContent,
    'frankfurter_fx': OmniFeedBlockContent,
    'wikipedia_search': OmniFeedBlockContent,
    'openlibrary_search': OmniFeedBlockContent,
    'github_repos': OmniFeedBlockContent,
    'crossref_works': OmniFeedBlockContent,

    // Workspace Blocks
    'text_note': TextBlockView,
    'code_sandbox': CodeBlockView,

    // Persona Blocks
    'persona_analyst': PersonaBlockView,
    'persona_strategist': PersonaBlockView,
    'persona_researcher': PersonaBlockView,
    'persona_creative': PersonaBlockView,
    'persona_guardian': PersonaBlockView,

    // Memory Blocks
    'memory_pool': MemoryBlockView,

    // Built-in speech. Registered ahead of the cap_ fallback so Speak and
    // Listen get their own controls instead of the generic capability view.
    'cap_speech_speak': SpeechBlockView,
    'cap_speech_listen': SpeechBlockView
};

export function getBlockView(blockId: string): React.ComponentType<{ instanceId: string }> | null {
    return BlockViews[blockId] ?? (blockId.startsWith('cap_') ? CapabilityBlockView : null);
}
