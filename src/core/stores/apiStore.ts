// ============================================
// PROJECT OMNI: API STORE
// Per-provider install state and status.
//
// Shipped keyed providers are proxied through /api/data with the key read
// from process.env. This store must not hold a secret — a custom-provider
// field that stored keys in the clear was removed rather than dressed up
// as encryption.
// ============================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
    ApiConfig,
    ApiStatus,
    API_CATALOG,
    ApiProvider,
    getApiProvider,
    getKeylessApis,
    isApiSupported
} from '../schemas/api.schema';
import { apiGateway } from '../gateway';

// ============================================
// STORE INTERFACE
// ============================================

interface ApiStoreState {
    /** API configurations by provider ID */
    configs: Record<string, ApiConfig>;

    /** Installed API provider IDs */
    installedApis: string[];
    installApi: (providerId: string) => void;

    /** Uninstall an API */
    uninstallApi: (providerId: string) => void;

    /** Check if API is installed */
    isInstalled: (providerId: string) => boolean;

    /** Update API status */
    updateStatus: (providerId: string, status: ApiStatus, errorMessage?: string) => void;

    /** Record an API request */
    recordRequest: (providerId: string) => void;

    /** Test API connection */
    testConnection: (providerId: string) => Promise<boolean>;

    /** Get all installed configs with provider details */
    getInstalledConfigs: () => (ApiConfig & { provider: ApiProvider })[];

    /** Initialize default APIs if store is empty */
    initializeDefaults: () => void;
}

// ============================================
// CREATE STORE
// ============================================

// Default APIs that come pre-installed (supported + no auth required)
const DEFAULT_INSTALLED_APIS = getKeylessApis().map(provider => provider.id);

type PersistedVault = {
    installedApis?: string[];
    configs?: Record<string, Record<string, unknown>>;
};

function isKeylessProvider(providerId: string): boolean {
    const provider = getApiProvider(providerId);
    return !!provider && !provider.requiresAuth;
}

function idleConfig(providerId: string) {
    return {
        providerId,
        status: 'idle' as ApiStatus,
        requestCount: 0
    };
}

/** Drop leftover client keys from older persisted vaults. Mutates configs in place. */
export function dropClientApiKeys(persisted: unknown): unknown {
    if (!persisted || typeof persisted !== 'object') return persisted;
    const state = persisted as PersistedVault;
    if (!state.configs) return persisted;
    for (const cfg of Object.values(state.configs)) {
        if ('encryptedKey' in cfg) {
            delete cfg.encryptedKey;
            cfg.status = 'not_configured';
        }
        delete cfg.apiKey;
    }
    return persisted;
}

/**
 * Add any shipped keyless provider that is missing from a persisted vault.
 * Used once on the v3 migrate so an existing Command Center picks up the
 * new demo APIs. Later uninstalls are left alone.
 */
export function withMissingKeylessInstalled(persisted: unknown): unknown {
    if (!persisted || typeof persisted !== 'object') return persisted;
    const state = persisted as PersistedVault;
    const installed = Array.isArray(state.installedApis) ? [...state.installedApis] : [];
    const configs = { ...(state.configs ?? {}) };
    let changed = false;

    for (const id of DEFAULT_INSTALLED_APIS) {
        if (!installed.includes(id)) {
            installed.push(id);
            changed = true;
        }
        const existing = configs[id];
        if (!existing) {
            configs[id] = idleConfig(id);
            changed = true;
        } else if (existing.status === 'not_configured' && isKeylessProvider(id)) {
            configs[id] = { ...existing, status: 'idle' };
            changed = true;
        }
    }

    if (!changed) return persisted;
    return { ...state, installedApis: installed, configs };
}

/** Persist migrate: strip leftover keys, then (until v3) install new keyless APIs. */
export function migrateApiVault(persisted: unknown, fromVersion: number): unknown {
    const stripped = dropClientApiKeys(persisted);
    if (fromVersion >= 3) return stripped;
    return withMissingKeylessInstalled(stripped);
}

export const useApiStore = create<ApiStoreState>()(
    persist(
        (set, get) => ({
            configs: {},
            installedApis: [],

            // Initialize defaults if store is empty
            initializeDefaults: () => {
                const state = get();
                if (state.installedApis.length === 0) {
                    set({
                        installedApis: DEFAULT_INSTALLED_APIS,
                        configs: DEFAULT_INSTALLED_APIS.reduce((acc, id) => ({
                            ...acc,
                            [id]: {
                                providerId: id,
                                status: 'idle' as ApiStatus,
                                requestCount: 0
                            }
                        }), {})
                    });
                }
            },

            installApi: (providerId) => {
                set(state => {
                    if (state.installedApis.includes(providerId)) return state;
                    if (!isApiSupported(providerId)) return state;

                    const provider = getApiProvider(providerId);
                    const initialStatus: ApiStatus = provider && !provider.requiresAuth
                        ? 'idle'
                        : 'not_configured';

                    return {
                        installedApis: [...state.installedApis, providerId],
                        configs: {
                            ...state.configs,
                            [providerId]: state.configs[providerId] || {
                                providerId,
                                status: initialStatus,
                                requestCount: 0
                            }
                        }
                    };
                });
            },

            uninstallApi: (providerId) => {
                set(state => ({
                    installedApis: state.installedApis.filter(id => id !== providerId)
                }));
            },

            isInstalled: (providerId) => {
                return get().installedApis.includes(providerId);
            },

            updateStatus: (providerId, status, errorMessage) => {
                set(state => ({
                    configs: {
                        ...state.configs,
                        [providerId]: {
                            ...state.configs[providerId],
                            providerId,
                            status,
                            errorMessage,
                            requestCount: state.configs[providerId]?.requestCount || 0
                        }
                    }
                }));
            },

            recordRequest: (providerId) => {
                set(state => ({
                    configs: {
                        ...state.configs,
                        [providerId]: {
                            ...state.configs[providerId],
                            providerId,
                            requestCount: (state.configs[providerId]?.requestCount || 0) + 1,
                            lastRequest: Date.now(),
                            status: state.configs[providerId]?.status || 'idle'
                        }
                    }
                }));
            },

            testConnection: async (providerId) => {
                const provider = getApiProvider(providerId);
                if (!provider) return false;

                set(state => ({
                    configs: {
                        ...state.configs,
                        [providerId]: {
                            ...state.configs[providerId],
                            providerId,
                            status: 'testing',
                            requestCount: state.configs[providerId]?.requestCount || 0
                        }
                    }
                }));

                try {
                    if (!apiGateway.isRegistered(providerId)) {
                        get().updateStatus(providerId, 'error', 'No gateway adapter registered for this API.');
                        return false;
                    }

                    const testParams = provider.integration?.testParams
                        || (provider.integration?.gateway?.type === 'normalizer'
                            ? provider.integration.gateway.defaultParams
                            : provider.integration?.gateway?.type === 'rest_list'
                                ? provider.integration.gateway.config.defaultParams
                                : undefined);

                    const result = await apiGateway.fetch(providerId, testParams, true);
                    if (result.error) {
                        get().updateStatus(providerId, 'error', result.error.message);
                        return false;
                    }

                    get().updateStatus(providerId, 'connected');
                    get().recordRequest(providerId);
                    return true;
                } catch (error) {
                    get().updateStatus(providerId, 'error', (error as Error).message);
                    return false;
                }
            },

            getInstalledConfigs: () => {
                const state = get();
                return state.installedApis.map(id => {
                    const provider = API_CATALOG.find(p => p.id === id);
                    const fallbackStatus: ApiStatus = provider && !provider.requiresAuth
                        ? 'idle'
                        : 'not_configured';
                    const config = state.configs[id] || {
                        providerId: id,
                        status: fallbackStatus,
                        requestCount: 0
                    };
                    const status = config.status === 'not_configured' && provider && !provider.requiresAuth
                        ? 'idle'
                        : config.status;
                    return { ...config, status, provider: provider! };
                }).filter(c => c.provider);
            }
        }),
        {
            name: 'omni-api-vault',
            version: 3,
            // v0 stored `encryptedKey` (XOR theatre). v1 stored a plaintext
            // `apiKey` for a custom-provider path nothing shipped used. Both
            // are dropped; keys live in process.env. v3 installs keyless
            // demo APIs that shipped after an older vault was first saved.
            migrate: (persisted: unknown, fromVersion: number) => migrateApiVault(persisted, fromVersion),
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                configs: state.configs,
                installedApis: state.installedApis
            })
        }
    )
);

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get status color for UI
 */
export function getStatusColor(status: ApiStatus): string {
    switch (status) {
        case 'connected': return 'var(--truth-green)';
        case 'idle': return 'var(--truth-amber)';
        case 'error': return 'var(--truth-red)';
        case 'testing': return 'var(--citadel-primary)';
        case 'not_configured': return 'var(--text-muted)';
        default: return 'var(--text-muted)';
    }
}
