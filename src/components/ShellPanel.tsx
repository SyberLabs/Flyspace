'use client';

// ============================================
// PROJECT OMNI: SHELL MANAGEMENT PANEL
// Save, load, and manage shell configurations
// ============================================

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShellStore, useBlockStore } from '@/core/stores';
import { ShellConfig } from '@/core/schemas/shell.schema';
import { SHELL_TEMPLATES, keyedProvidersForTemplate, type ShellTemplate } from '@/core/shells/templates';
import { newId } from '@/core/id';

interface ShellPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ShellPanel({ isOpen, onClose }: ShellPanelProps) {
    const {
        shells,
        hotkeySlots,
        saveShell,
        loadShell,
        createShell,
        deleteShell,
        assignHotkey,
        duplicateShell,
        instantiateTemplate
    } = useShellStore();

    const { activeShellId: currentActiveShell } = useBlockStore();

    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [newShellName, setNewShellName] = useState('');
    const [newShellDescription, setNewShellDescription] = useState('');
    const [saveShellName, setSaveShellName] = useState('');
    const [saveShellDescription, setSaveShellDescription] = useState('');

    // Get hotkey number for a shell
    const getHotkeyForShell = (shellId: string): number | undefined => {
        return Object.entries(hotkeySlots).find(([, id]) => id === shellId)?.[0] as unknown as number;
    };

    // Handle creating a new shell
    const handleCreateShell = () => {
        if (!newShellName.trim()) return;

        createShell(newShellName, newShellDescription);
        setNewShellName('');
        setNewShellDescription('');
        setShowCreateDialog(false);
    };

    // Handle saving current shell state
    const handleSaveCurrentShell = () => {
        if (!saveShellName.trim()) return;

        const shellId = `shell_${newId()}`;
        saveShell(shellId, {
            name: saveShellName,
            description: saveShellDescription,
            type: 'custom'
        });

        setSaveShellName('');
        setSaveShellDescription('');
        setShowSaveDialog(false);
    };

    // Handle loading a shell
    const handleLoadShell = (shellId: string) => {
        loadShell(shellId);
        onClose();
    };

    // Handle instantiating a built-in template into a fresh shell
    const handleUseTemplate = (template: ShellTemplate) => {
        const newShellId = instantiateTemplate(template);
        if (newShellId) onClose();
    };

    // Handle deleting a shell
    const handleDeleteShell = (shellId: string) => {
        if (confirm('Delete this shell? This action cannot be undone.')) {
            deleteShell(shellId);
        }
    };

    // Handle duplicating a shell
    const handleDuplicateShell = (shellId: string) => {
        const shell = shells.find(s => s.id === shellId);
        if (shell) {
            duplicateShell(shellId, `${shell.name} (Copy)`);
        }
    };

    // Handle assigning hotkey
    const handleAssignHotkey = (shellId: string) => {
        const slot = prompt('Enter hotkey slot (1-9):');
        const slotNum = parseInt(slot || '', 10);

        if (slotNum >= 1 && slotNum <= 9) {
            assignHotkey(shellId, slotNum);
        } else {
            alert('Invalid slot number. Please enter a number between 1-9.');
        }
    };

    // Group shells by type
    const systemShells = shells.filter(s => s.type === 'system');
    const customShells = shells.filter(s => s.type === 'custom');
    const templateShells = shells.filter(s => s.type === 'template');

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
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ x: -400, opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: -400, opacity: 0 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed left-0 top-0 bottom-0 w-[400px] bg-[var(--citadel-surface)] border-r border-[var(--citadel-border)] z-50 flex flex-col"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-[var(--citadel-border)]">
                            <div className="flex items-center justify-between mb-3">
                                <h2 className="text-xl font-semibold text-[var(--citadel-primary)]">
                                    Shell Manager
                                </h2>
                                <button
                                    onClick={onClose}
                                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                                >
                                    ✕
                                </button>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setShowCreateDialog(true)}
                                    className="flex-1 px-3 py-2 bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
                                >
                                    New Shell
                                </button>
                                <button
                                    onClick={() => setShowSaveDialog(true)}
                                    className="flex-1 px-3 py-2 bg-[var(--mind-aqua-surface)] text-[var(--citadel-void)] rounded-md hover:opacity-90 transition-opacity text-sm font-medium"
                                >
                                    Save Current
                                </button>
                            </div>
                        </div>

                        {/* Shell Lists */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-6">
                            {/* Active Shell Indicator */}
                            <div className="bg-[var(--citadel-void)] border border-[var(--citadel-primary)] rounded-lg p-3">
                                <div className="text-xs text-[var(--text-muted)] mb-1">Currently Active</div>
                                <div className="text-sm font-medium text-[var(--citadel-primary)]">
                                    {shells.find(s => s.id === currentActiveShell)?.name || 'Root Shell'}
                                </div>
                            </div>

                            {/* Shell Store — built-in templates */}
                            {SHELL_TEMPLATES.length > 0 && (
                                <div>
                                    <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">
                                        Shell Store
                                    </h3>
                                    <div className="space-y-2">
                                        {SHELL_TEMPLATES.map(template => (
                                            <div
                                                key={template.id}
                                                className="group bg-[var(--citadel-void)] border border-[var(--citadel-border)] hover:border-[var(--citadel-primary)]/50 rounded-lg p-3 transition-all"
                                            >
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h4 className="text-sm font-medium text-[var(--text-primary)]">
                                                        {template.name}
                                                    </h4>
                                                    <span className="text-[10px] px-2 py-0.5 bg-[var(--mind-aqua-surface)]/30 text-[var(--text-muted)] rounded-full">
                                                        TEMPLATE
                                                    </span>
                                                </div>
                                                <p className="text-xs text-[var(--text-muted)] mb-2 leading-relaxed">
                                                    {template.description}
                                                </p>
                                                <p className="text-[10px] text-[var(--text-muted)] mb-2">
                                                    {keyedProvidersLine(template)}
                                                </p>
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex flex-wrap gap-1">
                                                        {template.tags.map(tag => (
                                                            <span
                                                                key={tag}
                                                                className="text-[10px] px-1.5 py-0.5 bg-[var(--citadel-surface)] text-[var(--text-muted)] rounded"
                                                            >
                                                                {tag}
                                                            </span>
                                                        ))}
                                                    </div>
                                                    <button
                                                        onClick={() => handleUseTemplate(template)}
                                                        className="shrink-0 px-3 py-1.5 bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded-md hover:opacity-90 transition-opacity text-xs font-medium"
                                                    >
                                                        Use this shell
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* System Shells */}
                            {systemShells.length > 0 && (
                                <ShellSection
                                    title="System Shells"
                                    shells={systemShells}
                                    activeShellId={currentActiveShell}
                                    onLoad={handleLoadShell}
                                    onDelete={handleDeleteShell}
                                    onDuplicate={handleDuplicateShell}
                                    onAssignHotkey={handleAssignHotkey}
                                    getHotkeyForShell={getHotkeyForShell}
                                />
                            )}

                            {/* Custom Shells */}
                            {customShells.length > 0 && (
                                <ShellSection
                                    title="Custom Shells"
                                    shells={customShells}
                                    activeShellId={currentActiveShell}
                                    onLoad={handleLoadShell}
                                    onDelete={handleDeleteShell}
                                    onDuplicate={handleDuplicateShell}
                                    onAssignHotkey={handleAssignHotkey}
                                    getHotkeyForShell={getHotkeyForShell}
                                />
                            )}

                            {/* Template Shells */}
                            {templateShells.length > 0 && (
                                <ShellSection
                                    title="Templates"
                                    shells={templateShells}
                                    activeShellId={currentActiveShell}
                                    onLoad={handleLoadShell}
                                    onDelete={handleDeleteShell}
                                    onDuplicate={handleDuplicateShell}
                                    onAssignHotkey={handleAssignHotkey}
                                    getHotkeyForShell={getHotkeyForShell}
                                />
                            )}

                            {/* Empty State */}
                            {shells.length === 0 && (
                                <div className="text-center py-8 text-[var(--text-muted)]">
                                    <div className="mb-2">No saved shells yet</div>
                                    <div className="text-xs">Create or save a shell to get started</div>
                                </div>
                            )}
                        </div>

                        {/* Footer with keyboard shortcuts */}
                        <div className="p-4 border-t border-[var(--citadel-border)] bg-[var(--citadel-void)]">
                            <div className="text-xs text-[var(--text-muted)] space-y-1">
                                <div className="flex items-center gap-2">
                                    <kbd className="px-2 py-0.5 bg-[var(--citadel-surface)] rounded text-[10px]">Cmd+0</kbd>
                                    <span>Root Shell</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <kbd className="px-2 py-0.5 bg-[var(--citadel-surface)] rounded text-[10px]">Cmd+1-9</kbd>
                                    <span>Quick switch to assigned shells</span>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* Create Dialog */}
                    {showCreateDialog && (
                        <ShellDialog
                            title="Create New Shell"
                            nameValue={newShellName}
                            descriptionValue={newShellDescription}
                            onNameChange={setNewShellName}
                            onDescriptionChange={setNewShellDescription}
                            onConfirm={handleCreateShell}
                            onCancel={() => {
                                setShowCreateDialog(false);
                                setNewShellName('');
                                setNewShellDescription('');
                            }}
                            confirmText="Create"
                        />
                    )}

                    {/* Save Dialog */}
                    {showSaveDialog && (
                        <ShellDialog
                            title="Save Current Shell"
                            nameValue={saveShellName}
                            descriptionValue={saveShellDescription}
                            onNameChange={setSaveShellName}
                            onDescriptionChange={setSaveShellDescription}
                            onConfirm={handleSaveCurrentShell}
                            onCancel={() => {
                                setShowSaveDialog(false);
                                setSaveShellName('');
                                setSaveShellDescription('');
                            }}
                            confirmText="Save"
                        />
                    )}
                </>
            )}
        </AnimatePresence>
    );
}

function keyedProvidersLine(template: ShellTemplate): string {
    const keyed = keyedProvidersForTemplate(template);
    if (keyed.length === 0) return 'Works without API keys';
    const names = keyed.map(p => p.envVar).filter((name): name is string => Boolean(name));
    return `Needs ${names.join(', ')}`;
}

// ============================================
// SHELL SECTION COMPONENT
// ============================================

interface ShellSectionProps {
    title: string;
    shells: ShellConfig[];
    activeShellId: string;
    onLoad: (shellId: string) => void;
    onDelete: (shellId: string) => void;
    onDuplicate: (shellId: string) => void;
    onAssignHotkey: (shellId: string) => void;
    getHotkeyForShell: (shellId: string) => number | undefined;
}

function ShellSection({
    title,
    shells,
    activeShellId,
    onLoad,
    onDelete,
    onDuplicate,
    onAssignHotkey,
    getHotkeyForShell
}: ShellSectionProps) {
    return (
        <div>
            <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase mb-2">
                {title}
            </h3>
            <div className="space-y-2">
                {shells.map(shell => {
                    const hotkey = getHotkeyForShell(shell.id);
                    const isActive = shell.id === activeShellId;

                    return (
                        <div
                            key={shell.id}
                            className={`group bg-[var(--citadel-void)] border rounded-lg p-3 transition-all ${
                                isActive
                                    ? 'border-[var(--citadel-primary)] ring-1 ring-[var(--citadel-primary)]/30'
                                    : 'border-[var(--citadel-border)] hover:border-[var(--citadel-primary)]/50'
                            }`}
                        >
                            {/* Shell Header */}
                            <div className="flex items-start justify-between mb-2">
                                <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                        <h4 className="text-sm font-medium text-[var(--text-primary)]">
                                            {shell.name}
                                        </h4>
                                        {hotkey && (
                                            <kbd className="px-1.5 py-0.5 bg-[var(--citadel-primary)]/20 border border-[var(--citadel-primary)] rounded text-[10px] text-[var(--citadel-primary)]">
                                                ⌘{hotkey}
                                            </kbd>
                                        )}
                                        {isActive && (
                                            <span className="text-[10px] px-2 py-0.5 bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded-full">
                                                ACTIVE
                                            </span>
                                        )}
                                    </div>
                                    {shell.description && (
                                        <p className="text-xs text-[var(--text-muted)] mt-1">
                                            {shell.description}
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Shell Metadata */}
                            <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] mb-2">
                                <span>{shell.blocks.length} blocks</span>
                                <span>•</span>
                                <span>{shell.persona}</span>
                                <span>•</span>
                                <span>{shell.aesthetic}</span>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => onLoad(shell.id)}
                                    className="px-2 py-1 bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded text-xs hover:opacity-90 transition-opacity"
                                >
                                    Load
                                </button>
                                <button
                                    onClick={() => onDuplicate(shell.id)}
                                    className="px-2 py-1 bg-[var(--citadel-surface)] text-[var(--text-primary)] rounded text-xs hover:bg-[var(--citadel-border)] transition-colors"
                                >
                                    Duplicate
                                </button>
                                <button
                                    onClick={() => onAssignHotkey(shell.id)}
                                    className="px-2 py-1 bg-[var(--citadel-surface)] text-[var(--text-primary)] rounded text-xs hover:bg-[var(--citadel-border)] transition-colors"
                                >
                                    Hotkey
                                </button>
                                <button
                                    onClick={() => onDelete(shell.id)}
                                    className="px-2 py-1 bg-[var(--truth-red)]/20 text-[var(--truth-red)] rounded text-xs hover:bg-[var(--truth-red)]/30 transition-colors ml-auto"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ============================================
// SHELL DIALOG COMPONENT
// ============================================

interface ShellDialogProps {
    title: string;
    nameValue: string;
    descriptionValue: string;
    onNameChange: (value: string) => void;
    onDescriptionChange: (value: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText: string;
}

function ShellDialog({
    title,
    nameValue,
    descriptionValue,
    onNameChange,
    onDescriptionChange,
    onConfirm,
    onCancel,
    confirmText
}: ShellDialogProps) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed inset-0 flex items-center justify-center z-[60]"
            onClick={onCancel}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-[var(--citadel-surface)] border border-[var(--citadel-border)] rounded-lg p-6 w-[400px] shadow-2xl"
            >
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
                    {title}
                </h3>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm text-[var(--text-muted)] mb-1">
                            Shell Name
                        </label>
                        <input
                            type="text"
                            value={nameValue}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="My Workspace"
                            className="w-full px-3 py-2 bg-[var(--citadel-void)] border border-[var(--citadel-border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="block text-sm text-[var(--text-muted)] mb-1">
                            Description (optional)
                        </label>
                        <textarea
                            value={descriptionValue}
                            onChange={(e) => onDescriptionChange(e.target.value)}
                            placeholder="What is this shell for?"
                            rows={3}
                            className="w-full px-3 py-2 bg-[var(--citadel-void)] border border-[var(--citadel-border)] rounded-md text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)] resize-none"
                        />
                    </div>
                </div>

                <div className="flex gap-2 mt-6">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2 bg-[var(--citadel-void)] text-[var(--text-primary)] rounded-md hover:bg-[var(--citadel-border)] transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!nameValue.trim()}
                        className="flex-1 px-4 py-2 bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </motion.div>
    );
}
