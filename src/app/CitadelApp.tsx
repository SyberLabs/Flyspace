'use client';

// ============================================
// OMNIOS: MAIN APPLICATION
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@/canvas/Canvas';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { CommandPalette } from '@/components/CommandPalette';
import { Info } from 'lucide-react';
import { ApiDashboardModal } from '@/components/ApiDashboard';
import { ShellPanel } from '@/components/ShellPanel';
import { MindPanel } from '@/components/mind';
import { MindDock } from '@/components/mind/MindDock';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { ContextCaptureModal } from '@/components/mind/ContextCaptureModal';
import { useBlockStore, useToolStore } from '@/core/stores';
import { useApiStore } from '@/core/stores/apiStore';
import { useMindShellSync, useShellNavigation } from '@/core/hooks';

export default function CitadelApp() {
    const { activeShellId } = useBlockStore();
    const { activeTool, selection, captureSelection, clearSelection } = useToolStore();
    const { initializeDefaults } = useApiStore();

    const [isMindOpen, setIsMindOpen] = useState(false);
    const [isLibraryOpen, setIsLibraryOpen] = useState(false);
    const [isApiOpen, setIsApiOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isShellsOpen, setIsShellsOpen] = useState(false);

    // Initialize Mind-Shell synchronization
    useMindShellSync();

    // Initialize shell keyboard navigation (Cmd+0-9)
    useShellNavigation();

    // Initialize default APIs and Systems
    useEffect(() => {
        initializeDefaults();
    }, [initializeDefaults]);

    // Global selection handler for Highlighter tool
    const handleMouseUp = useCallback(() => {
        if (activeTool !== 'highlighter') return;

        const windowSelection = window.getSelection();
        const text = windowSelection?.toString().trim();

        if (text && text.length > 0) {
            captureSelection({ text });
            // windowSelection?.removeAllRanges(); // Optional: clear selection
        }
    }, [activeTool, captureSelection]);
    return (
        <div
            className={`flex flex-col h-dvh overflow-hidden bg-[var(--sy-bg)] ${activeTool === 'highlighter' ? 'cursor-text' : ''}`}
            onMouseUp={handleMouseUp}
        >
            <TopBar
                onOpenApi={() => setIsApiOpen(true)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenShells={() => setIsShellsOpen(true)}
                onToggleLibrary={() => setIsLibraryOpen(o => !o)}
                isLibraryOpen={isLibraryOpen}
            />

            {process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO === '1' && (
                <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--sy-line)] text-sm text-[var(--sy-text-2)]" role="note">
                    <Info className="w-5 h-5 flex-none text-[var(--sy-brand)]" strokeWidth={1.5} aria-hidden="true" />
                    <p>
                        <span className="font-semibold text-[var(--sy-text)]">Public preview.</span>{' '}
                        Your canvas stays in this browser. AI answers and keyed data sources are off.
                    </p>
                </div>
            )}

            <div className="relative flex flex-1 overflow-hidden">
                {/* Block library: a column on desktop, a drawer below 768px */}
                <Sidebar isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} />
                {isLibraryOpen && (
                    <button
                        type="button"
                        aria-label="Close block library"
                        className="md:hidden absolute inset-0 z-30 bg-[rgba(5,6,10,0.72)]"
                        onClick={() => setIsLibraryOpen(false)}
                    />
                )}

                {/* Canvas follows the active shell (root by default, or a
                    template-spawned shell after using the Shell Store) */}
                <main className="flex-1 overflow-hidden relative">
                    <Canvas shellId={activeShellId} onBrowseShells={() => setIsShellsOpen(true)} />
                    <MindDock onExpandPanel={() => setIsMindOpen(true)} />
                </main>
            </div>

            <CommandPalette />
            <ShellPanel isOpen={isShellsOpen} onClose={() => setIsShellsOpen(false)} />
            <MindPanel isOpen={isMindOpen} onClose={() => setIsMindOpen(false)} />
            <ApiDashboardModal isOpen={isApiOpen} onClose={() => setIsApiOpen(false)} />
            <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

            {/* Context Capture Modal (for Highlighter tool) */}
            <ContextCaptureModal
                isOpen={!!selection?.text}
                onClose={clearSelection}
                selectedText={selection?.text || ''}
            />
        </div>
    );
}
