'use client';

// ============================================
// PROJECT OMNI: TEXT NOTE BLOCK
// Markdown notes with preview toggle
// ============================================

import { useState, useCallback } from 'react';
import { useBlockStore } from '@/core/stores';
import { Eye, Edit3, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TextBlockData {
    content: string;
    lastSaved: number;
}

interface TextBlockViewProps {
    instanceId: string;
}

export function TextBlockView({ instanceId }: TextBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);

    const storedContent = (block?.data as TextBlockData | undefined)?.content ?? '';
    const [isPreview, setIsPreview] = useState(false);
    const [content, setContent] = useState(storedContent);
    const [hasUnsaved, setHasUnsaved] = useState(false);
    const [seenStored, setSeenStored] = useState(storedContent);
    if (storedContent !== seenStored) {
        setSeenStored(storedContent);
        if (!hasUnsaved) setContent(storedContent);
    }

    const handleSave = useCallback(() => {
        updateData(instanceId, {
            content,
            lastSaved: Date.now()
        });
        setHasUnsaved(false);
    }, [instanceId, content, updateData]);

    const handleContentChange = (value: string) => {
        setContent(value);
        setHasUnsaved(true);
    };

    // Simple markdown to HTML (basic implementation)
    const renderMarkdown = (text: string) => {
        return text
            .replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-3 mb-1">$1</h3>')
            .replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>')
            .replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>')
            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/gim, '<em>$1</em>')
            .replace(/`(.*?)`/gim, '<code class="px-1 py-0.5 bg-[var(--citadel-surface)] rounded text-sm font-mono">$1</code>')
            .replace(/\n/gim, '<br />');
    };

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--citadel-border)] bg-[var(--citadel-surface)]/50">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsPreview(!isPreview)}
                        className={cn(
                            "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
                            isPreview
                                ? "bg-[var(--citadel-primary)]/20 text-[var(--citadel-primary)]"
                                : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        )}
                    >
                        {isPreview ? (
                            <>
                                <Eye className="w-3.5 h-3.5" />
                                Preview
                            </>
                        ) : (
                            <>
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                            </>
                        )}
                    </button>
                </div>

                <button
                    onClick={handleSave}
                    disabled={!hasUnsaved}
                    className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors",
                        hasUnsaved
                            ? "bg-[var(--truth-green)]/20 text-[var(--truth-green)] hover:bg-[var(--truth-green)]/30"
                            : "text-[var(--text-muted)] opacity-50"
                    )}
                >
                    <Save className="w-3.5 h-3.5" />
                    {hasUnsaved ? 'Save' : 'Saved'}
                </button>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-auto p-3">
                {isPreview ? (
                    <div
                        className="prose prose-invert prose-sm max-w-none text-[var(--text-primary)]"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(content) || '<span class="text-[var(--text-muted)]">Nothing to preview...</span>' }}
                    />
                ) : (
                    <textarea
                        value={content}
                        onChange={(e) => handleContentChange(e.target.value)}
                        placeholder="# Start writing...

Use **bold** and *italic* for emphasis.
Use `code` for inline code.
Use # ## ### for headings."
                        className="w-full h-full bg-transparent text-[var(--text-primary)] text-sm font-mono resize-none focus:outline-none placeholder:text-[var(--text-muted)]/50"
                    />
                )}
            </div>
        </div>
    );
}
