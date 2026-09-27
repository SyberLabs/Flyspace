'use client';

// ============================================
// PROJECT OMNI: EMBED BLOCK
// External web content iframe
// ============================================

import { useState, useCallback } from 'react';
import { useBlockStore } from '@/core/stores';
import { Globe, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmbedBlockData {
    url: string;
    lastUpdated: number;
}

interface EmbedBlockViewProps {
    instanceId: string;
}

export function EmbedBlockView({ instanceId }: EmbedBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);

    const storedUrl = (block?.data as EmbedBlockData | undefined)?.url ?? '';
    const [url, setUrl] = useState(storedUrl);
    const [inputUrl, setInputUrl] = useState(storedUrl);
    const [seenUrl, setSeenUrl] = useState(storedUrl);
    if (storedUrl !== seenUrl) {
        setSeenUrl(storedUrl);
        setUrl(storedUrl);
        setInputUrl(storedUrl);
    }
    const [isLoading, setIsLoading] = useState(false);
    const [hasError, setHasError] = useState(false);

    const handleLoadUrl = useCallback(() => {
        if (!inputUrl.trim()) return;

        // Ensure URL has protocol
        let finalUrl = inputUrl.trim();
        if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
            finalUrl = 'https://' + finalUrl;
        }

        setUrl(finalUrl);
        setIsLoading(true);
        setHasError(false);

        updateData(instanceId, {
            url: finalUrl,
            lastUpdated: Date.now()
        });
    }, [inputUrl, instanceId, updateData]);

    const handleRefresh = () => {
        setIsLoading(true);
        setHasError(false);
        // Force iframe refresh by temporarily clearing and resetting URL
        const currentUrl = url;
        setUrl('');
        setTimeout(() => setUrl(currentUrl), 100);
    };

    const handleIframeLoad = () => {
        setIsLoading(false);
    };

    const handleIframeError = () => {
        setIsLoading(false);
        setHasError(true);
    };

    return (
        <div className="flex flex-col h-full">
            {/* URL Bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--citadel-border)] bg-[var(--citadel-surface)]/50">
                <Globe className="w-4 h-4 text-[var(--text-muted)]" />
                <input
                    type="url"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="Enter URL..."
                    className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    onKeyDown={(e) => e.key === 'Enter' && handleLoadUrl()}
                />
                <button
                    onClick={handleLoadUrl}
                    className="px-2 py-1 text-xs font-medium bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded hover:opacity-90"
                >
                    Go
                </button>
                {url && (
                    <>
                        <button
                            onClick={handleRefresh}
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            title="Refresh"
                        >
                            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
                        </button>
                        <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                            title="Open in new tab"
                        >
                            <ExternalLink className="w-4 h-4" />
                        </a>
                    </>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 relative">
                {!url ? (
                    <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
                        <div className="text-center">
                            <Globe className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Enter a URL to embed</p>
                            <p className="text-xs mt-1 opacity-70">Some sites may block embedding</p>
                        </div>
                    </div>
                ) : hasError ? (
                    <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)]">
                        <div className="text-center">
                            <AlertTriangle className="w-12 h-12 mx-auto mb-3 text-[var(--truth-amber)]" />
                            <p className="text-sm">Could not load this URL</p>
                            <p className="text-xs mt-1 opacity-70">The site may block embedding (X-Frame-Options)</p>
                            <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 mt-3 text-xs text-[var(--citadel-primary)] hover:underline"
                            >
                                <ExternalLink className="w-3 h-3" />
                                Open in new tab
                            </a>
                        </div>
                    </div>
                ) : (
                    <>
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center bg-[var(--citadel-bg)]">
                                <RefreshCw className="w-6 h-6 text-[var(--text-muted)] animate-spin" />
                            </div>
                        )}
                        <iframe
                            src={url}
                            className="w-full h-full border-0"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                            onLoad={handleIframeLoad}
                            onError={handleIframeError}
                            title="Embedded content"
                        />
                    </>
                )}
            </div>
        </div>
    );
}

export default EmbedBlockView;
