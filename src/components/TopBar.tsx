'use client';

// ============================================
// OMNIOS: TOP BAR
// SYBERLABS / OMNIOS lockup | canvas + tools | command search | status + settings
// ============================================

import {
    Command,
    Settings,
    Wifi,
    Database,
    KeyRound,
    MousePointer2,
    Highlighter,
    Layers,
    PanelLeft
} from 'lucide-react';
import { useShellStore, useSettingsStore, useUIStore, useToolStore } from '@/core/stores';
import { useApiStore } from '@/core/stores/apiStore';
import { LlmStatusPill } from './LlmStatusPill';
import { useClientMounted } from '@/core/hooks';

export function Lockup() {
    return (
        <span className="sy-lockup" aria-label="SyberLabs / OmniOS">
            {/* eslint-disable-next-line @next/next/no-img-element -- 20px static mark, no optimisation needed */}
            <img src="/syberlabs-mark.png" alt="" width={18} height={20} />
            <span>SYBERLABS</span>
            <span className="sy-lockup-sep" aria-hidden="true">/</span>
            <span className="sy-lockup-product">
                <span className="sy-dot bg-[var(--sy-accent-omnios)]" aria-hidden="true" />
                OMNIOS
            </span>
        </span>
    );
}

export function TopBar({
    onOpenApi,
    onOpenSettings,
    onOpenShells,
    onToggleLibrary,
    isLibraryOpen = false
}: {
    onOpenApi?: () => void;
    onOpenSettings?: () => void;
    onOpenShells?: () => void;
    onToggleLibrary?: () => void;
    isLibraryOpen?: boolean;
}) {
    const { getActiveShell } = useShellStore();
    const { useMockData, toggleMockData } = useSettingsStore();
    const { openCommandPalette } = useUIStore();
    const { activeTool, setTool } = useToolStore();
    const { installedApis } = useApiStore();

    const hasMounted = useClientMounted();
    const activeShell = hasMounted ? getActiveShell() : undefined;

    return (
        <header className="topbar gap-2 md:gap-4 px-2 md:px-4">
            {/* Left: lockup, canvas, tools */}
            <div className="flex items-center gap-2 min-w-0">
                {onToggleLibrary && (
                    <button
                        type="button"
                        onClick={onToggleLibrary}
                        className="sy-icon-btn md:hidden"
                        aria-label={isLibraryOpen ? 'Close block library' : 'Open block library'}
                        aria-expanded={isLibraryOpen}
                        aria-controls="block-library"
                    >
                        <PanelLeft />
                    </button>
                )}

                <Lockup />

                <div className="hidden lg:block w-px h-6 bg-[var(--sy-line)] mx-2" aria-hidden="true" />

                {/* Canvas (shell) manager */}
                <button
                    type="button"
                    onClick={onOpenShells}
                    className="hidden md:inline-flex items-center gap-2 h-11 px-3 rounded-lg text-sm font-medium text-[var(--sy-text-2)] hover:text-[var(--sy-text)] hover:bg-[var(--sy-surface-2)] transition-colors min-w-0"
                    title="Shell Manager"
                >
                    <Layers className="w-5 h-5 flex-none" strokeWidth={1.5} />
                    <span>Shells</span>
                    {activeShell && (
                        <span className="hidden xl:inline text-[var(--sy-text-3)] truncate max-w-[160px]">
                            · {activeShell.name}
                        </span>
                    )}
                </button>

                {/* Tools */}
                <div className="hidden lg:flex items-center" role="group" aria-label="Canvas tool">
                    <button
                        type="button"
                        onClick={() => setTool('navigate')}
                        className="sy-icon-btn"
                        aria-pressed={activeTool === 'navigate'}
                        aria-label="Navigate"
                        title="Navigate (V)"
                    >
                        <MousePointer2 />
                    </button>
                    <button
                        type="button"
                        onClick={() => setTool('highlighter')}
                        className="sy-icon-btn"
                        aria-pressed={activeTool === 'highlighter'}
                        aria-label="Highlight text to capture context"
                        title="Context Highlighter (H)"
                    >
                        <Highlighter />
                    </button>
                </div>
            </div>

            {/* Center: command search */}
            <div className="hidden md:flex flex-1 justify-center min-w-0">
                <button
                    type="button"
                    onClick={openCommandPalette}
                    className="flex items-center gap-3 h-11 px-4 w-full max-w-sm bg-[var(--sy-surface)] border border-[var(--sy-line-strong)] rounded-lg text-[var(--sy-text-3)] hover:text-[var(--sy-text-2)] transition-colors"
                >
                    <Command className="w-4 h-4 flex-none" strokeWidth={1.5} />
                    <span className="text-sm truncate">Search commands</span>
                    <kbd className="ml-auto sy-label border border-[var(--sy-line)] rounded px-1.5">⌘K</kbd>
                </button>
            </div>

            {/* Right: status + settings */}
            <div className="flex items-center gap-1">
                <div className="hidden md:block mr-1">
                    <LlmStatusPill />
                </div>

                <button
                    type="button"
                    onClick={toggleMockData}
                    className="sy-icon-btn hidden md:inline-flex"
                    title={useMockData ? 'Using mock data - click to try live API' : 'Using live API'}
                    aria-label={useMockData ? 'Data: mock. Switch to live data' : 'Data: live. Switch to mock data'}
                >
                    {useMockData ? <Database /> : <Wifi />}
                </button>

                <button
                    type="button"
                    onClick={onOpenApi}
                    className="sy-icon-btn hidden md:inline-flex relative"
                    title="API Dashboard"
                    aria-label={`API sources${hasMounted && installedApis.length > 0 ? `, ${installedApis.length} installed` : ''}`}
                >
                    <KeyRound />
                    {hasMounted && installedApis.length > 0 && (
                        <span className="absolute top-1 right-0.5 min-w-5 h-5 px-1 rounded-full bg-[var(--sy-surface-2)] border border-[var(--sy-line)] font-mono text-xs leading-[18px] text-[var(--sy-text-2)]">
                            {installedApis.length}
                        </span>
                    )}
                </button>

                <button
                    type="button"
                    onClick={onOpenShells}
                    className="sy-icon-btn md:hidden"
                    aria-label="Shells"
                >
                    <Layers />
                </button>

                <button
                    type="button"
                    onClick={onOpenSettings}
                    className="sy-icon-btn"
                    title="System Settings"
                    aria-label="Settings"
                >
                    <Settings />
                </button>
            </div>
        </header>
    );
}

export default TopBar;
