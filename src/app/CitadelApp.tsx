'use client';

// ============================================
// PROJECT OMNI: MAIN APPLICATION
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { Canvas } from '@/canvas/Canvas';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { CommandPalette } from '@/components/CommandPalette';
import { SkinModal } from '@/components/SkinModal';
import { Sprout } from 'lucide-react';
import Link from 'next/link';
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
    const [isSkinOpen, setIsSkinOpen] = useState(false);
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
            className={`flex flex-col h-screen overflow-hidden bg-[var(--citadel-void)] ${activeTool === 'highlighter' ? 'cursor-text' : ''}`}
            onMouseUp={handleMouseUp}
        >
            {/* Top Bar */}
            <TopBar
                onOpenSkin={() => setIsSkinOpen(true)}
                onOpenApi={() => setIsApiOpen(true)}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenShells={() => setIsShellsOpen(true)}
            />

            {process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO === '1' && (
                <div className="px-3 py-2 text-xs text-center text-white bg-slate-800">
                    Public preview: your canvas stays in this browser. AI answers and keyed data sources are disabled.
                </div>
            )}

            {/* Main Content */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar / Armory */}
                <Sidebar />

                {/* Canvas Workspace - follows the active shell (root by default,
                    or a template-spawned shell after using the Shell Store) */}
                <main className="flex-1 overflow-hidden relative">
                    <Canvas shellId={activeShellId} onBrowseShells={() => setIsShellsOpen(true)} />

                    {/* Mind Dock - Always Visible */}
                    <MindDock onExpandPanel={() => setIsMindOpen(true)} />

                    {/* Garden FAB - Bottom Right */}
                    <Link
                        href="/garden"
                        className="absolute bottom-6 right-6 z-30 group"
                    >
                        <div className="flex items-center gap-2 px-4 py-3 rounded-full bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50 hover:scale-105 transition-all duration-200">
                            <Sprout className="w-5 h-5" />
                            <span className="text-sm font-medium">Garden</span>
                        </div>
                    </Link>
                </main>
            </div>

            {/* Command Palette */}
            <CommandPalette />

            {/* Shell Manager Panel */}
            <ShellPanel isOpen={isShellsOpen} onClose={() => setIsShellsOpen(false)} />

            {/* Mind Panel */}
            <MindPanel isOpen={isMindOpen} onClose={() => setIsMindOpen(false)} />

            {/* Skin Modal */}
            <SkinModal isOpen={isSkinOpen} onClose={() => setIsSkinOpen(false)} />

            {/* API Dashboard Modal */}
            <ApiDashboardModal isOpen={isApiOpen} onClose={() => setIsApiOpen(false)} />

            {/* Settings Panel */}
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


