'use client';

// ============================================
// PROJECT OMNI: API DASHBOARD & MARKETPLACE
// Unified API management interface
// ============================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Search,
    Key,
    CheckCircle,
    XCircle,
    Circle,
    CircleDashed,
    Loader2,
    Check,
    Trash2,
    ExternalLink,
    Download,
    Settings,
    TrendingUp,
    Newspaper,
    Globe,
    Activity,
    Sparkles,
    CloudSun,
    MessageSquare,
    Code,
    DollarSign,
    RefreshCw
} from 'lucide-react';
import { useApiStore, getStatusColor } from '@/core/stores/apiStore';
import {
    API_CATALOG,
    ApiProvider,
    ApiCategory,
    getApisByCategory,
    searchApis,
    getApiSupportLevel,
    getKeylessApis,
    isApiSupported
} from '@/core/schemas/api.schema';
import { cn } from '@/lib/utils';
import { BlockGlyph } from '@/components/blockIcons';

// ============================================
// CATEGORY ICONS & LABELS
// ============================================

const CATEGORY_CONFIG: Record<ApiCategory, { icon: React.ReactNode; label: string }> = {
    truth: { icon: <TrendingUp className="w-4 h-4" />, label: 'Truth' },
    pulse: { icon: <Newspaper className="w-4 h-4" />, label: 'Pulse' },
    physicality: { icon: <Globe className="w-4 h-4" />, label: 'Physicality' },
    bio: { icon: <Activity className="w-4 h-4" />, label: 'Bio' },
    ai: { icon: <Sparkles className="w-4 h-4" />, label: 'AI & LLM' },
    environment: { icon: <CloudSun className="w-4 h-4" />, label: 'Environment' },
    social: { icon: <MessageSquare className="w-4 h-4" />, label: 'Social' },
    developer: { icon: <Code className="w-4 h-4" />, label: 'Developer' },
    economy: { icon: <DollarSign className="w-4 h-4" />, label: 'Economy' },
    custom: { icon: <Settings className="w-4 h-4" />, label: 'Custom' }
};

// ============================================
// MAIN COMPONENT
// ============================================

interface ApiDashboardModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ApiDashboardModal({ isOpen, onClose }: ApiDashboardModalProps) {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'marketplace'>('dashboard');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<ApiCategory | 'all'>('all');

    const { installedApis, getInstalledConfigs } = useApiStore();
    const installedConfigs = getInstalledConfigs();
    const supportedCount = API_CATALOG.filter(api => isApiSupported(api.id)).length;
    const keylessCount = getKeylessApis().length;

    // Count by status
    const statusCounts = {
        connected: installedConfigs.filter(c => c.status === 'connected').length,
        idle: installedConfigs.filter(c => c.status === 'idle').length,
        error: installedConfigs.filter(c => c.status === 'error').length,
        notConfigured: installedConfigs.filter(c => c.status === 'not_configured').length
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        className="fixed inset-0 bg-[rgba(5,6,10,0.72)] z-50"
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-4xl max-h-[85vh] flex flex-col"
                    >
                        <div className="bg-[var(--sy-surface)] border border-[var(--sy-line)] rounded-lg shadow-[var(--sy-shadow-overlay)] overflow-hidden flex flex-col h-full">
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--citadel-border)]">
                                <div className="flex items-center gap-4">
                                                                        <div>
                                        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                                            API Command Center
                                        </h2>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {installedApis.length} installed | {supportedCount} supported | {keylessCount} work without a key
                                        </p>
                                    </div>
                                </div>

                                {/* Tab Switcher */}
                                <div className="flex items-center gap-2 bg-[var(--citadel-surface)] rounded-lg p-1">
                                    <button
                                        onClick={() => setActiveTab('dashboard')}
                                        className={cn(
                                            "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                                            activeTab === 'dashboard'
                                                ? "bg-[var(--sy-text)] text-[var(--sy-on-primary)]"
                                                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                        )}
                                    >
                                        Dashboard
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('marketplace')}
                                        className={cn(
                                            "px-4 py-1.5 rounded-md text-sm font-medium transition-all",
                                            activeTab === 'marketplace'
                                                ? "bg-[var(--sy-text)] text-[var(--sy-on-primary)]"
                                                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                        )}
                                    >
                                        Marketplace
                                    </button>
                                </div>

                                <button
                                    onClick={onClose}
                                    className="sy-icon-btn"
                                    aria-label="Close API sources"
                                >
                                    <X />
                                </button>
                            </div>

                            {/* Content */}
                            <div className="flex-1 overflow-hidden">
                                {activeTab === 'dashboard' ? (
                                    <DashboardView
                                        configs={installedConfigs}
                                        statusCounts={statusCounts}
                                    />
                                ) : (
                                    <MarketplaceView
                                        searchQuery={searchQuery}
                                        setSearchQuery={setSearchQuery}
                                        selectedCategory={selectedCategory}
                                        setSelectedCategory={setSelectedCategory}
                                    />
                                )}
                            </div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

// ============================================
// DASHBOARD VIEW
// ============================================

interface DashboardViewProps {
    configs: ReturnType<typeof useApiStore.getState>['getInstalledConfigs'] extends () => infer R ? R : never;
    statusCounts: { connected: number; idle: number; error: number; notConfigured: number };
}

function DashboardView({ configs, statusCounts }: DashboardViewProps) {
    const [expandedApi, setExpandedApi] = useState<string | null>(null);

    if (configs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                <Key className="w-12 h-12 text-[var(--text-muted)] mb-4 opacity-50" />
                <h3 className="text-lg font-medium text-[var(--text-primary)]">No APIs Installed</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                    Visit the Marketplace to discover and install APIs
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            {/* Status Summary */}
            <div className="flex items-center gap-4 px-6 py-4 border-b border-[var(--citadel-border)]">
                <StatusBadge icon={<CheckCircle />} count={statusCounts.connected} label="Connected" color="var(--truth-green)" />
                <StatusBadge icon={<Circle />} count={statusCounts.idle} label="Idle" color="var(--text-muted)" />
                <StatusBadge icon={<XCircle />} count={statusCounts.error} label="Error" color="var(--truth-red)" />
                <StatusBadge icon={<CircleDashed />} count={statusCounts.notConfigured} label="Not Configured" color="var(--text-muted)" />
            </div>

            {/* API List */}
            <div className="flex-1 overflow-auto px-4 py-2">
                {configs.map(config => (
                    <ApiConfigCard
                        key={config.providerId}
                        config={config}
                        isExpanded={expandedApi === config.providerId}
                        onToggle={() => setExpandedApi(expandedApi === config.providerId ? null : config.providerId)}
                    />
                ))}
            </div>
        </div>
    );
}

function StatusBadge({ icon, count, label, color }: { icon: React.ReactNode; count: number; label: string; color: string }) {
    return (
        <div className="flex items-center gap-2 py-2">
            <span style={{ color }} aria-hidden="true">{icon}</span>
            <span className="text-lg font-semibold text-[var(--sy-text)]">{count}</span>
            <span className="text-sm text-[var(--sy-text-3)]">{label}</span>
        </div>
    );
}

// ============================================
// API CONFIG CARD
// ============================================

interface ApiConfigCardProps {
    config: ReturnType<typeof useApiStore.getState>['getInstalledConfigs'] extends () => (infer R)[] ? R : never;
    isExpanded: boolean;
    onToggle: () => void;
}

function ApiConfigCard({ config, isExpanded, onToggle }: ApiConfigCardProps) {
    const { testConnection, uninstallApi } = useApiStore();
    const [isTesting, setIsTesting] = useState(false);


    const handleTest = async () => {
        setIsTesting(true);
        await testConnection(config.providerId);
        setIsTesting(false);
    };

    const StatusIcon = config.status === 'connected' ? CheckCircle
        : config.status === 'error' ? XCircle
            : config.status === 'idle' ? Circle
                : config.status === 'testing' ? Loader2
                    : CircleDashed;

    return (
        <div className="border-b border-[var(--sy-line)]">
            {/* Header Row */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 px-2 min-h-16 py-3 rounded-lg hover:bg-[var(--sy-surface-2)] transition-colors"
            >
                <BlockGlyph name={config.provider.icon} className="w-5 h-5 flex-none text-[var(--sy-text-3)]" />
                <div className="flex-1 text-left">
                    <p className="text-sm font-medium text-[var(--text-primary)]">{config.provider.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{config.provider.description}</p>
                </div>
                <div className="flex items-center gap-3">
                    <StatusIcon
                        className={cn("w-4 h-4", config.status === 'testing' && "animate-spin")}
                        style={{ color: getStatusColor(config.status) }}
                        aria-hidden="true"
                    />
                    <span className="text-sm text-[var(--sy-text-2)] capitalize">
                        {config.status.replace('_', ' ')}
                    </span>
                    <span className="hidden sm:inline font-mono text-xs text-[var(--sy-text-3)] w-24 text-right">
                        {config.requestCount} requests
                    </span>
                </div>
            </button>

            {/* Expanded Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-[var(--citadel-border)]"
                    >
                        <div className="p-4 space-y-4">
                            {/* Server-keyed providers: nothing to enter here.
                                The key lives in .env and is applied by /api/data. */}
                            {config.provider.serverKeyed && (
                                <div className="px-3 py-2 bg-[var(--truth-green)]/10 border border-[var(--truth-green)]/20 rounded-lg">
                                    <p className="text-xs text-[var(--truth-green)] font-medium">
                                        Key configured server-side
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">
                                        Set {config.provider.envVar ?? 'the env var'} in <code>.env</code> and restart. It is never sent to the browser.
                                    </p>
                                </div>
                            )}

                            {!config.provider.requiresAuth && (
                                <div className="px-3 py-2 bg-[var(--truth-green)]/10 border border-[var(--truth-green)]/20 rounded-lg">
                                    <p className="text-xs text-[var(--truth-green)] font-medium">
                                        No API key required
                                    </p>
                                    <p className="text-xs text-[var(--text-muted)] mt-1">
                                        Works on the canvas with nothing in <code>.env</code>. Drag its block from the block library.
                                    </p>
                                </div>
                            )}

                            {/* Error Message */}
                            {config.status === 'error' && config.errorMessage && (
                                <div className="px-3 py-2 bg-[var(--truth-red)]/10 border border-[var(--truth-red)]/20 rounded-lg">
                                    <p className="text-xs text-[var(--truth-red)]">{config.errorMessage}</p>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleTest}
                                    disabled={isTesting}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--citadel-primary)] hover:bg-[var(--citadel-primary)]/10 rounded-lg transition-colors"
                                >
                                    <RefreshCw className={cn("w-3.5 h-3.5", isTesting && "animate-spin")} />
                                    Test Connection
                                </button>
                                {config.provider.docsUrl && (
                                    <a
                                        href={config.provider.docsUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                    >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                        Docs
                                    </a>
                                )}
                                <div className="flex-1" />
                                <button
                                    onClick={() => uninstallApi(config.providerId)}
                                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[var(--truth-red)] hover:bg-[var(--truth-red)]/10 rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Uninstall
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ============================================
// MARKETPLACE VIEW
// ============================================

interface MarketplaceViewProps {
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    selectedCategory: ApiCategory | 'all';
    setSelectedCategory: (category: ApiCategory | 'all') => void;
}

function MarketplaceView({ searchQuery, setSearchQuery, selectedCategory, setSelectedCategory }: MarketplaceViewProps) {
    const { isInstalled, installApi } = useApiStore();

    const filteredApis = searchQuery
        ? searchApis(searchQuery)
        : selectedCategory === 'all'
            ? API_CATALOG
            : getApisByCategory(selectedCategory);

    const categories = Object.keys(CATEGORY_CONFIG) as ApiCategory[];

    return (
        <div className="flex flex-col h-full">
            {/* Search & Filter Bar */}
            <div className="px-6 py-4 border-b border-[var(--citadel-border)] space-y-3">
                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search APIs..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[var(--citadel-surface)] border border-[var(--citadel-border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                </div>

                {/* Category Pills */}
                <div className="flex flex-wrap gap-2">
                    <button
                        onClick={() => setSelectedCategory('all')}
                        className={cn(
                            "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                            selectedCategory === 'all'
                                ? "bg-[var(--sy-text)] text-[var(--sy-on-primary)]"
                                : "bg-[var(--citadel-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        )}
                    >
                        All ({API_CATALOG.length})
                    </button>
                    {categories.filter(c => c !== 'custom').map(category => (
                        <button
                            key={category}
                            onClick={() => setSelectedCategory(category)}
                            className={cn(
                                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                                selectedCategory === category
                                    ? "bg-[var(--sy-text)] text-[var(--sy-on-primary)]"
                                    : "bg-[var(--citadel-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            )}
                            aria-pressed={selectedCategory === category}
                        >
                            {CATEGORY_CONFIG[category].icon}
                            {CATEGORY_CONFIG[category].label}
                        </button>
                    ))}
                </div>
            </div>

            {/* API Grid */}
            <div className="flex-1 overflow-auto p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-6">
                    {filteredApis.map(api => (
                        <ApiMarketplaceCard
                            key={api.id}
                            api={api}
                            isInstalled={isInstalled(api.id)}
                            onInstall={() => installApi(api.id)}
                        />
                    ))}
                </div>
                {filteredApis.length === 0 && (
                    <div className="text-center py-12">
                        <Search className="w-8 h-8 mx-auto text-[var(--text-muted)] opacity-50 mb-2" />
                        <p className="text-sm text-[var(--text-muted)]">No APIs found</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================
// MARKETPLACE CARD
// ============================================

interface ApiMarketplaceCardProps {
    api: ApiProvider;
    isInstalled: boolean;
    onInstall: () => void;
}

function ApiMarketplaceCard({ api, isInstalled, onInstall }: ApiMarketplaceCardProps) {
    const supportLevel = getApiSupportLevel(api.id);
    const canInstall = isApiSupported(api.id);
    const supportLabel =
        supportLevel === 'supported' ? 'Supported' : supportLevel === 'experimental' ? 'Experimental' : 'Planned';

    return (
        <div className="border-t border-[var(--sy-line)] py-4">
            <div className="flex items-start gap-3">
                <BlockGlyph name={api.icon} className="w-5 h-5 mt-0.5 flex-none text-[var(--sy-text-3)]" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{api.name}</p>
                    <p className="text-xs text-[var(--text-muted)] line-clamp-2 mt-0.5">{api.description}</p>
                </div>
            </div>

            <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        api.pricing === 'free' && "bg-[var(--truth-green)]/20 text-[var(--truth-green)]",
                        api.pricing === 'freemium' && "bg-[var(--truth-amber)]/20 text-[var(--truth-amber)]",
                        api.pricing === 'paid' && "bg-[var(--citadel-primary)]/20 text-[var(--citadel-primary)]",
                        api.pricing === 'open_source' && "bg-[var(--mind-aqua-surface)]/20 text-[var(--mind-aqua-surface)]"
                    )}>
                        {api.pricing === 'free' ? 'Free' : api.pricing === 'freemium' ? 'Freemium' : api.pricing === 'paid' ? 'Paid' : 'Open Source'}
                    </span>
                    {!api.requiresAuth && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--truth-green)]/15 text-[var(--truth-green)]">
                            No key
                        </span>
                    )}
                    <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full",
                        supportLevel === 'supported' && "bg-[var(--truth-green)]/15 text-[var(--truth-green)]",
                        supportLevel === 'experimental' && "bg-[var(--truth-amber)]/15 text-[var(--truth-amber)]",
                        supportLevel === 'planned' && "bg-[var(--citadel-border)]/60 text-[var(--text-muted)]"
                    )}>
                        {supportLabel}
                    </span>
                </div>

                <button
                    onClick={onInstall}
                    disabled={isInstalled || !canInstall}
                    className={cn(
                        "flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium transition-colors",
                        isInstalled
                            ? "bg-[var(--truth-green)]/20 text-[var(--truth-green)]"
                            : canInstall
                                ? "bg-[var(--sy-text)] text-[var(--sy-on-primary)] hover:opacity-90"
                                : "bg-[var(--citadel-border)] text-[var(--text-muted)] cursor-not-allowed"
                    )}
                >
                    {isInstalled ? (
                        <>
                            <Check className="w-3 h-3" />
                            Installed
                        </>
                    ) : !canInstall ? (
                        <>
                            <CircleDashed className="w-3 h-3" />
                            Planned
                        </>
                    ) : (
                        <>
                            <Download className="w-3 h-3" />
                            Install
                        </>
                    )}
                </button>
            </div>

            {api.freeTierLimits && (
                <p className="text-xs text-[var(--text-muted)] mt-2">{api.freeTierLimits}</p>
            )}
        </div>
    );
}

export default ApiDashboardModal;

