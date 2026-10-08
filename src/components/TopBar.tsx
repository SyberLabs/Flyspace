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
    Layers
} from 'lucide-react';
import { useShellStore, useSettingsStore, useUIStore, useToolStore } from '@/core/stores';
import { LlmStatusPill } from './LlmStatusPill';
import { cn } from '@/lib/utils';
import { useClientMounted } from '@/core/hooks';
import { Sigil } from './brand/Sigil';

export function TopBar({
    onOpenSettings,
    onOpenShells
}: {
    onOpenSettings?: () => void;
    onOpenShells?: () => void;
}) {
    const { getActiveShell } = useShellStore();
    const { useMockData, toggleMockData } = useSettingsStore();
    const { openCommandPalette } = useUIStore();
    const { activeTool, setTool } = useToolStore();

    const hasMounted = useClientMounted();

    const activeShell = hasMounted ? getActiveShell() : undefined;

    return (
        <header className="topbar">
            {/* Left: Logo */}
            <div className="flex items-center gap-4">
                <h1 className="lockup" aria-label="SyberLabs Flyspace">
                    {/* eslint-disable-next-line @next/next/no-img-element -- 22px static brand mark */}
                    <img src="/syber-mark.png" alt="" width={22} height={24} className="lockup-mark" />
                    <span className="lockup-name hidden md:inline">SYBERLABS</span>
                    <span className="lockup-sep hidden md:inline" aria-hidden="true">/</span>
                    <span className="lockup-product">Flyspace</span>
                    <Sigil size={16} className="lockup-sigil" />
                </h1>

                {/* Current Shell */}
                {activeShell && (
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
            </div>

            {/* Center: Command Palette */}
            <div className="flex-1 flex justify-center px-4">
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
            </div>

            {/* Right: Status Bar */}
            <div className="flex items-center gap-2">
                {/* Status Bar Group */}
                <div className="topbar-pill">

                    <div className="w-px h-4 bg-[var(--citadel-border)]" />

                    {/* LLM availability (startup ping; click to re-check) */}
                    <LlmStatusPill />

                    <div className="w-px h-4 bg-[var(--citadel-border)]" />

                    {/* Refresh rate (fast/normal); all data is live either way */}
                    <button
                        onClick={toggleMockData}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs transition-colors",
                            useMockData
                                ? "text-[var(--truth-amber)] hover:bg-[var(--truth-amber)]/10"
                                : "text-[var(--truth-green)] hover:bg-[var(--truth-green)]/10"
                        )}
                        title={useMockData
                            ? "Fast refresh: live data polled every 5–60 s - click for normal refresh"
                            : "Normal refresh: live data polled every 1–60 min - click for fast refresh"}
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
