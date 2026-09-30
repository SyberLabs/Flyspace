'use client';

// ============================================
// PROJECT OMNI: COMMAND PALETTE (CMD+K)
// ============================================

import { useEffect, useCallback, useMemo } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    Layers,
    Save,
    Moon,
    Sun,
    Grid
} from 'lucide-react';
import { useUIStore, useShellStore, useBlockStore, useSettingsStore } from '@/core/stores';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { BlockGlyph } from '@/components/blockIcons';

export function CommandPalette() {
    const { commandPaletteOpen, closeCommandPalette, toggleCommandPalette } = useUIStore();
    const { shells, createShell, loadShell } = useShellStore();
    const { addBlock, clearCanvas } = useBlockStore();
    const { useMockData, toggleMockData, gridSnapping, updateSetting } = useSettingsStore();

    // Keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                toggleCommandPalette();
            }
            if (e.key === 'Escape' && commandPaletteOpen) {
                closeCommandPalette();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [toggleCommandPalette, closeCommandPalette, commandPaletteOpen]);

    // All available blocks
    const blocks = useMemo(() => blockRegistry.getAll(), []);

    // Command handlers
    const handleAddBlock = useCallback((blockId: string) => {
        const schema = blockRegistry.get(blockId);
        if (schema) {
            addBlock(schema, { x: 350, y: 100 + Math.random() * 100 });
            closeCommandPalette();
        }
    }, [addBlock, closeCommandPalette]);

    const handleCreateShell = useCallback(() => {
        const name = `Shell ${shells.length + 1}`;
        createShell(name);
        closeCommandPalette();
    }, [createShell, shells.length, closeCommandPalette]);

    const handleLoadShell = useCallback((shellId: string) => {
        loadShell(shellId);
        closeCommandPalette();
    }, [loadShell, closeCommandPalette]);

    const handleClearCanvas = useCallback(() => {
        clearCanvas();
        closeCommandPalette();
    }, [clearCanvas, closeCommandPalette]);

    const handleToggleMock = useCallback(() => {
        toggleMockData();
        closeCommandPalette();
    }, [toggleMockData, closeCommandPalette]);

    const handleToggleGrid = useCallback(() => {
        updateSetting('gridSnapping', !gridSnapping);
        closeCommandPalette();
    }, [gridSnapping, updateSetting, closeCommandPalette]);

    return (
        <AnimatePresence>
            {commandPaletteOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="command-palette-overlay"
                    onClick={closeCommandPalette}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: -20 }}
                        transition={{ duration: 0.15 }}
                        onClick={(e) => e.stopPropagation()}
                        className="command-palette"
                    >
                        <Command label="Command Palette" className="w-full">
                            {/* Search Input */}
                            <div className="flex items-center gap-3 px-4 border-b border-[var(--citadel-border)]">
                                <Search className="w-5 h-5 text-[var(--text-muted)]" />
                                <Command.Input
                                    placeholder="Type a command or search..."
                                    className="command-palette-input border-none px-0"
                                />
                            </div>

                            {/* Command List */}
                            <Command.List className="command-palette-list">
                                <Command.Empty className="px-4 py-8 text-center text-[var(--text-muted)]">
                                    No results found.
                                </Command.Empty>

                                {/* Quick Actions */}
                                <Command.Group heading="Quick Actions" className="px-2 py-2">
                                    <CommandItem
                                        icon={<Save className="w-4 h-4" />}
                                        label="Save Current Shell"
                                        shortcut="⌘S"
                                        onSelect={handleCreateShell}
                                    />
                                    <CommandItem
                                        icon={<Layers className="w-4 h-4" />}
                                        label="Clear Canvas"
                                        onSelect={handleClearCanvas}
                                    />
                                </Command.Group>

                                {/* Add Blocks */}
                                <Command.Group heading="Add Block" className="px-2 py-2">
                                    {blocks.map(block => (
                                        <CommandItem
                                            key={block.block_id}
                                            icon={<BlockGlyph name={block.icon} className="w-4 h-4" />}
                                            label={block.display_name}
                                            description={block.description}
                                            onSelect={() => handleAddBlock(block.block_id)}
                                        />
                                    ))}
                                </Command.Group>

                                {/* Shells */}
                                {shells.length > 0 && (
                                    <Command.Group heading="Switch Shell" className="px-2 py-2">
                                        {shells.map(shell => (
                                            <CommandItem
                                                key={shell.id}
                                                icon={<Layers className="w-4 h-4" />}
                                                label={shell.name}
                                                description={`${shell.blocks.length} blocks`}
                                                onSelect={() => handleLoadShell(shell.id)}
                                            />
                                        ))}
                                    </Command.Group>
                                )}

                                {/* Settings */}
                                <Command.Group heading="Settings" className="px-2 py-2">
                                    <CommandItem
                                        icon={useMockData ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                                        label={useMockData ? "Using Mock Data" : "Using Live API"}
                                        description="Toggle between mock and live data"
                                        onSelect={handleToggleMock}
                                    />
                                    <CommandItem
                                        icon={<Grid className="w-4 h-4" />}
                                        label={gridSnapping ? "Grid Snapping: ON" : "Grid Snapping: OFF"}
                                        description="Toggle canvas grid snapping"
                                        onSelect={handleToggleGrid}
                                    />
                                </Command.Group>
                            </Command.List>
                        </Command>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

// ============================================
// COMMAND ITEM COMPONENT
// ============================================

interface CommandItemProps {
    icon: React.ReactNode;
    label: string;
    description?: string;
    shortcut?: string;
    onSelect: () => void;
}

function CommandItem({ icon, label, description, shortcut, onSelect }: CommandItemProps) {
    return (
        <Command.Item
            onSelect={onSelect}
            className="command-item"
        >
            <span className="command-item-icon text-[var(--text-secondary)]">
                {icon}
            </span>
            <div className="flex-1 min-w-0">
                <span className="command-item-label block">{label}</span>
                {description && (
                    <span className="text-xs text-[var(--text-muted)] block truncate">
                        {description}
                    </span>
                )}
            </div>
            {shortcut && (
                <span className="command-item-shortcut">{shortcut}</span>
            )}
        </Command.Item>
    );
}
