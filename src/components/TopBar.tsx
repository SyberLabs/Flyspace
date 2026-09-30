'use client';

// ============================================
// PROJECT OMNI: TOP BAR (Refined)
// Clean separation: Logo | Tools | Command | Status | Settings
// ============================================

import {
    Command,
    Settings,
    Wifi,
    Database,
    MousePointer2,
    Highlighter,
    ChevronRight,
    Layers
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useShellStore, useSettingsStore, useUIStore, useToolStore } from '@/core/stores';
import { LlmStatusPill } from './LlmStatusPill';
import { cn } from '@/lib/utils';
import { useClientMounted } from '@/core/hooks';
import { Sigil } from './brand/Sigil';

export function TopBar({
    onOpenSettings,
    onOpenShells,
    children,
    customRight
}: {
    onOpenSettings?: () => void;
    onOpenShells?: () => void;
    children?: React.ReactNode;
    customRight?: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const { getActiveShell } = useShellStore();
    const { useMockData, toggleMockData } = useSettingsStore();
    const { openCommandPalette } = useUIStore();
    const { activeTool, setTool } = useToolStore();

    const hasMounted = useClientMounted();

    const activeShell = hasMounted ? getActiveShell() : undefined;
    const isHome = pathname === '/';

    // Helper to generate breadcrumbs
    const renderBreadcrumbs = () => {
        if (isHome) {
            return (
                <h1 className="lockup" aria-label="SyberLabs OmniOS">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 22px static brand mark */}
                    <img src="/syber-mark.png" alt="" width={22} height={24} className="lockup-mark" />
                    <span className="lockup-name hidden md:inline">SYBERLABS</span>
                    <span className="lockup-sep hidden md:inline" aria-hidden="true">/</span>
                    <span className="lockup-product">OmniOS</span>
                    <Sigil size={16} className="lockup-sigil" />
                </h1>
            );
        }

        const parts = pathname.split('/').filter(Boolean);

        return (
            <div className="flex items-center gap-1">
                <button
                    onClick={() => router.push('/')}
                    className="flex items-center gap-2 p-1.5 rounded-full hover:bg-[var(--citadel-elevated)] transition-colors"
                    title="Back to Citadel"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element -- 22px static brand mark */}
                    <img src="/syber-mark.png" alt="" width={22} height={24} className="lockup-mark" />
                    <Sigil size={16} className="lockup-sigil" />
                </button>

                {parts.map((part, index) => {
                    const isLast = index === parts.length - 1;
                    const path = `/${parts.slice(0, index + 1).join('/')}`;
                    const label = part.charAt(0).toUpperCase() + part.slice(1);

                    // Paths that are just structural containers and don't have pages
                    const isNonClickable = path === '/garden/system';

                    return (
                        <div key={path} className="flex items-center gap-1">
                            <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
                            {isLast || isNonClickable ? (
                                <span className={cn(
                                    "text-sm",
                                    isLast ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                                )}>
                                    {label}
                                </span>
                            ) : (
                                <button
                                    onClick={() => router.push(path)}
                                    className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:underline transition-all"
                                >
                                    {label}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <header className="topbar">
            {/* Left: Breadcrumbs / Logo */}
            <div className="flex items-center gap-4">
                {renderBreadcrumbs()}

                {/* Vertical Divider if not Home */}
                {!isHome && <div className="w-px h-6 bg-[var(--citadel-border)]" />}

                {/* Current Shell (Only on Home/Citadel) */}
                {isHome && activeShell && (
                    <>
                        <div className="w-px h-6 bg-[var(--citadel-border)]" />
                        <div className="topbar-pill px-3 gap-2">
                            <span className="text-xs text-[var(--text-muted)]">Shell:</span>
                            <span className="text-xs font-medium text-[var(--text-primary)]">
                                {activeShell.name}
                            </span>
                        </div>
                    </>
                )}

                {/* Shell Manager + Tool Strip (Only on Home/Citadel) */}
                {isHome && (
                    <>
                        {/* Shell Manager Button */}
                        <button
                            onClick={onOpenShells}
                            className="btn btn-line btn-sm"
                            title="Shell Manager"
                        >
                            <Layers className="text-[var(--citadel-secondary)]" />
                            <span>Shells</span>
                        </button>

                        <div className="w-px h-6 bg-[var(--citadel-border)]" />

                        {/* Tool Strip */}
                        <div className="topbar-pill hidden sm:flex">
                            <button
                                onClick={() => setTool('navigate')}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-all",
                                    activeTool === 'navigate'
                                        ? "bg-[var(--citadel-primary)]/20 text-[var(--citadel-primary)]"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--citadel-surface)]"
                                )}
                                title="Navigate (V)"
                            >
                                <MousePointer2 className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Navigate</span>
                            </button>
                            <button
                                onClick={() => setTool('highlighter')}
                                className={cn(
                                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-all",
                                    activeTool === 'highlighter'
                                        ? "bg-[var(--cyan-glow)]/20 text-[var(--cyan-glow)]"
                                        : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--citadel-surface)]"
                                )}
                                title="Context Highlighter (H)"
                            >
                                <Highlighter className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Highlight</span>
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Center: Children usually, or Command Palette */}
            <div className="flex-1 flex justify-center px-4">
                {children || (
                    <button
                        onClick={openCommandPalette}
                        className="hidden md:flex items-center gap-2 px-4 min-h-9 bg-[color-mix(in_srgb,var(--citadel-void)_40%,transparent)] border border-[var(--citadel-border)] rounded-full hover:border-[var(--ice)] transition-colors group max-w-sm w-full"
                    >
                        <Command className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--ice)]" />
                        <span className="text-sm text-[var(--text-muted)] truncate">
                            Search commands...
                        </span>
                        <kbd className="ml-auto px-2 py-0.5 text-xs font-mono border border-[var(--citadel-border)] rounded-full text-[var(--text-secondary)]">
                            ⌘K
                        </kbd>
                    </button>
                )}
            </div>

            {/* Right: Custom Content + Status Bar */}
            <div className="flex items-center gap-2">
                {customRight}

                {/* Status Bar Group (Only on Home or when relevant) */}
                <div className="topbar-pill">

                    <div className="w-px h-4 bg-[var(--citadel-border)]" />

                    {/* LLM availability (startup ping; click to re-check) */}
                    <LlmStatusPill />

                    <div className="w-px h-4 bg-[var(--citadel-border)]" />

                    {/* Data Mode (Live/Mock) */}
                    <button
                        onClick={toggleMockData}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs transition-colors",
                            useMockData
                                ? "text-[var(--truth-amber)] hover:bg-[var(--truth-amber)]/10"
                                : "text-[var(--truth-green)] hover:bg-[var(--truth-green)]/10"
                        )}
                        title={useMockData ? "Using mock data - click to try live API" : "Using live API"}
                    >
                        {useMockData ? (
                            <Database className="w-3.5 h-3.5" />
                        ) : (
                            <Wifi className="w-3.5 h-3.5" />
                        )}
                    </button>
                </div>

                {/* Settings */}
                <button
                    onClick={onOpenSettings}
                    className="p-2 rounded-full border border-transparent hover:border-[var(--citadel-border)] hover:bg-[var(--citadel-elevated)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                    title="System Settings"
                >
                    <Settings className="w-4 h-4" />
                </button>
            </div>
        </header>
    );
}


export default TopBar;
