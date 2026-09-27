'use client';

// ============================================
// PROJECT OMNI: CODE BLOCK
// Syntax-highlighted code display
// ============================================

import { useState } from 'react';
import { useBlockStore } from '@/core/stores';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CodeBlockData {
    content: string;
    language: string;
    lastSaved: number;
}

const LANGUAGES = [
    'javascript', 'typescript', 'python', 'json', 'html', 'css',
    'bash', 'sql', 'markdown', 'yaml', 'rust', 'go'
];

/** Module-level so Date.now is not an impure call during render. */
export function persistCode(
    instanceId: string,
    content: string,
    language: string,
    updateData: (instanceId: string, data: CodeBlockData) => void
): void {
    updateData(instanceId, { content, language, lastSaved: Date.now() });
}

interface CodeBlockViewProps {
    instanceId: string;
}

export function CodeBlockView({ instanceId }: CodeBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);

    const stored = block?.data as CodeBlockData | undefined;
    const content = stored?.content ?? '';
    const language = stored?.language ?? 'javascript';
    const [copied, setCopied] = useState(false);
    const [showLangPicker, setShowLangPicker] = useState(false);

    const handleContentChange = (value: string) => {
        persistCode(instanceId, value, language, updateData);
    };

    const handleLanguageChange = (lang: string) => {
        setShowLangPicker(false);
        persistCode(instanceId, content, lang, updateData);
    };

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--citadel-border)] bg-[var(--citadel-surface)]/50">
                {/* Language Picker */}
                <div className="relative">
                    <button
                        onClick={() => setShowLangPicker(!showLangPicker)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--citadel-surface)] border border-[var(--citadel-border)]"
                    >
                        {language}
                        <ChevronDown className="w-3 h-3" />
                    </button>

                    {showLangPicker && (
                        <div className="absolute top-full left-0 mt-1 z-10 bg-[var(--citadel-elevated)] border border-[var(--citadel-border)] rounded-lg shadow-[var(--sy-shadow-overlay)] py-1 min-w-[120px]">
                            {LANGUAGES.map(lang => (
                                <button
                                    key={lang}
                                    onClick={() => handleLanguageChange(lang)}
                                    className={cn(
                                        "w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--citadel-surface)]",
                                        lang === language ? "text-[var(--citadel-primary)]" : "text-[var(--text-secondary)]"
                                    )}
                                >
                                    {lang}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Copy Button */}
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                    {copied ? (
                        <>
                            <Check className="w-3.5 h-3.5 text-[var(--truth-green)]" />
                            Copied!
                        </>
                    ) : (
                        <>
                            <Copy className="w-3.5 h-3.5" />
                            Copy
                        </>
                    )}
                </button>
            </div>

            {/* Code Content */}
            <div className="flex-1 overflow-auto p-3 bg-[var(--citadel-bg)]">
                <textarea
                    value={content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    placeholder="// Paste or write your code here..."
                    spellCheck={false}
                    className="w-full h-full bg-transparent text-[var(--text-primary)] text-sm font-mono resize-none focus:outline-none placeholder:text-[var(--text-muted)]/50 leading-relaxed"
                />
            </div>
        </div>
    );
}

export default CodeBlockView;
