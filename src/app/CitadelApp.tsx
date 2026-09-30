'use client';

// ============================================
// PROJECT OMNI: MAIN APPLICATION
// ============================================

import { useState, useCallback } from 'react';
import { Canvas } from '@/canvas/Canvas';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { CommandPalette } from '@/components/CommandPalette';
import { SkinModal } from '@/components/SkinModal';
import { Sprout } from 'lucide-react';
import Link from 'next/link';
import { ShellPanel } from '@/components/ShellPanel';
import { MindPanel } from '@/components/mind';
import { MindDock } from '@/components/mind/MindDock';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { ContextCaptureModal } from '@/components/mind/ContextCaptureModal';
import { useBlockStore, useToolStore } from '@/core/stores';
import { useMindShellSync, useShellNavigation } from '@/core/hooks';
import { VoiceControl } from '@/components/voice/VoiceControl';

export default function CitadelApp() {
    const { activeShellId } = useBlockStore();
    const { activeTool, selection, captureSelection, clearSelection } = useToolStore();

    const [isMindOpen, setIsMindOpen] = useState(false);
    const [isSkinOpen, setIsSkinOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isShellsOpen, setIsShellsOpen] = useState(false);

    // Initialize Mind-Shell synchronization
    useMindShellSync();

    // Initialize shell keyboard navigation (Cmd+0-9)
    useShellNavigation();

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
                onOpenSettings={() => setIsSettingsOpen(true)}
                onOpenShells={() => setIsShellsOpen(true)}
            />

            {process.env.NEXT_PUBLIC_OMNI_PUBLIC_DEMO === '1' && (
                <div className="demo-banner" role="note">
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
                    <VoiceControl />

                    {/* Mind Dock - Always Visible */}
                    <MindDock onExpandPanel={() => setIsMindOpen(true)} />

                    {/* Garden FAB - Bottom Right */}
                    <Link
                        href="/garden"
                        className="absolute bottom-6 right-6 z-30 group"
                    >
                        <div className="btn garden-pill">
                            <Sprout />
                            <span>Garden</span>
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


