'use client';

// ============================================
// PROJECT OMNI: MEDIA BLOCK
// Image, video, and PDF gallery with local upload
// ============================================

import { useState, useCallback, useRef, useMemo } from 'react';
import { useBlockStore } from '@/core/stores';
import { Plus, X, Image as ImageIcon, Film, ExternalLink, Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaItem {
    id: string;
    type: 'image' | 'video' | 'pdf';
    url: string;
    name?: string;
    caption?: string;
    addedAt: number;
}

interface MediaBlockData {
    items: MediaItem[];
    lastUpdated: number;
}

interface MediaBlockViewProps {
    instanceId: string;
}

const ACCEPTED_FILE_TYPES = {
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/jpg': 'image',
    'image/gif': 'image',
    'image/webp': 'image',
    'application/pdf': 'pdf',
    'video/mp4': 'video',
    'video/webm': 'video',
} as const;

export function MediaBlockView({ instanceId }: MediaBlockViewProps) {
    const block = useBlockStore(state => state.blocks.find(b => b.instance_id === instanceId));
    const updateData = useBlockStore(state => state.updateData);

    const items = useMemo(
        () => (block?.data as MediaBlockData | undefined)?.items ?? [],
        [block?.data]
    );
    const [showAddUrl, setShowAddUrl] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const saveItems = useCallback((newItems: MediaItem[]) => {
        updateData(instanceId, {
            items: newItems,
            lastUpdated: Date.now()
        });
    }, [instanceId, updateData]);

    const addMediaFromUrl = useCallback(() => {
        if (!urlInput.trim()) return;

        const isVideo = /\.(mp4|webm|ogg)$/i.test(urlInput) ||
            urlInput.includes('youtube.com') ||
            urlInput.includes('vimeo.com');

        const isPdf = /\.pdf$/i.test(urlInput);

        const newItem: MediaItem = {
            id: `media-${Date.now()}`,
            type: isPdf ? 'pdf' : isVideo ? 'video' : 'image',
            url: urlInput.trim(),
            addedAt: Date.now()
        };

        saveItems([...items, newItem]);
        setUrlInput('');
        setShowAddUrl(false);
    }, [urlInput, items, saveItems]);

    const addMediaFromFiles = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        const newItems: MediaItem[] = [];

        for (const file of fileArray) {
            const fileType = ACCEPTED_FILE_TYPES[file.type as keyof typeof ACCEPTED_FILE_TYPES];
            if (!fileType) continue;

            // Convert to base64 data URL
            const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.readAsDataURL(file);
            });

            newItems.push({
                id: `media-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                type: fileType,
                url: dataUrl,
                name: file.name,
                addedAt: Date.now()
            });
        }

        if (newItems.length > 0) {
            saveItems([...items, ...newItems]);
        }
    }, [items, saveItems]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            addMediaFromFiles(e.target.files);
            e.target.value = ''; // Reset input
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            addMediaFromFiles(e.dataTransfer.files);
        }
    }, [addMediaFromFiles]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const removeItem = useCallback((itemId: string) => {
        saveItems(items.filter(i => i.id !== itemId));
    }, [items, saveItems]);

    const renderMediaItem = (item: MediaItem) => {
        if (item.type === 'pdf') {
            return (
                <div
                    className="w-full h-full flex flex-col items-center justify-center bg-[var(--citadel-surface)] cursor-pointer"
                    onClick={() => window.open(item.url, '_blank')}
                >
                    <FileText className="w-8 h-8 text-[var(--truth-red)]" />
                    <span className="text-xs text-[var(--text-muted)] mt-1 px-2 truncate max-w-full">
                        {item.name || 'PDF'}
                    </span>
                </div>
            );
        }

        if (item.type === 'video') {
            return (
                <div className="w-full h-full flex items-center justify-center">
                    <Film className="w-8 h-8 text-[var(--text-muted)]" />
                </div>
            );
        }

        return (
            <img
                src={item.url}
                alt={item.caption || item.name || 'Media'}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setSelectedItem(item)}
                onError={(e) => {
                    (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
                }}
            />
        );
    };

    return (
        <div
            className="flex flex-col h-full"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.mp4,.webm"
                onChange={handleFileSelect}
                className="hidden"
            />

            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--citadel-border)] bg-[var(--citadel-surface)]/50">
                <span className="text-xs text-[var(--text-muted)]">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                </span>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-[var(--citadel-primary)] hover:bg-[var(--citadel-primary)]/10 transition-colors"
                    >
                        <Upload className="w-3.5 h-3.5" />
                        Upload
                    </button>
                    <button
                        onClick={() => setShowAddUrl(!showAddUrl)}
                        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--citadel-surface)] transition-colors"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        URL
                    </button>
                </div>
            </div>

            {/* Add URL Input */}
            {showAddUrl && (
                <div className="p-3 border-b border-[var(--citadel-border)] bg-[var(--citadel-surface)]/30">
                    <div className="flex gap-2">
                        <input
                            type="url"
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            placeholder="Paste image, video, or PDF URL..."
                            className="flex-1 px-3 py-2 bg-[var(--citadel-bg)] border border-[var(--citadel-border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                            onKeyDown={(e) => e.key === 'Enter' && addMediaFromUrl()}
                        />
                        <button
                            onClick={addMediaFromUrl}
                            disabled={!urlInput.trim()}
                            className="px-3 py-2 bg-[var(--citadel-primary)] text-[var(--citadel-void)] rounded-lg text-sm font-medium disabled:opacity-50"
                        >
                            Add
                        </button>
                    </div>
                </div>
            )}

            {/* Gallery Grid */}
            <div className={cn(
                "flex-1 overflow-auto p-3 transition-colors",
                isDragging && "bg-[var(--citadel-primary)]/10 ring-2 ring-inset ring-[var(--citadel-primary)]"
            )}>
                {isDragging ? (
                    <div className="h-full flex flex-col items-center justify-center text-[var(--citadel-primary)]">
                        <Upload className="w-10 h-10 mb-2" />
                        <p className="text-sm font-medium">Drop files here</p>
                        <p className="text-xs opacity-70">PNG, JPG, PDF, MP4</p>
                    </div>
                ) : items.length === 0 ? (
                    <div
                        className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] text-sm cursor-pointer hover:bg-[var(--citadel-surface)]/50 rounded-lg transition-colors"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <ImageIcon className="w-8 h-8 mb-2 opacity-50" />
                        <p>No media yet</p>
                        <p className="text-xs mt-1">Click to upload or drag & drop</p>
                        <p className="text-xs text-[var(--text-muted)]/70 mt-1">PNG, JPG, PDF, MP4</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 gap-2">
                        {items.map(item => (
                            <div
                                key={item.id}
                                className="relative group aspect-video bg-[var(--citadel-surface)] rounded-lg overflow-hidden border border-[var(--citadel-border)]"
                            >
                                {renderMediaItem(item)}

                                {/* Overlay Controls */}
                                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                                    {!item.url.startsWith('data:') && (
                                        <a
                                            href={item.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-2 bg-white/20 rounded-full hover:bg-white/30"
                                        >
                                            <ExternalLink className="w-4 h-4 text-white" />
                                        </a>
                                    )}
                                    <button
                                        onClick={() => removeItem(item.id)}
                                        className="p-2 bg-red-500/50 rounded-full hover:bg-red-500/70"
                                    >
                                        <X className="w-4 h-4 text-white" />
                                    </button>
                                </div>

                                {/* File name badge for local files */}
                                {item.name && (
                                    <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/70 text-xs text-white truncate">
                                        {item.name}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Lightbox */}
            {selectedItem && selectedItem.type === 'image' && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
                    onClick={() => setSelectedItem(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white"
                        onClick={() => setSelectedItem(null)}
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <img
                        src={selectedItem.url}
                        alt={selectedItem.caption || selectedItem.name || 'Media'}
                        className="max-w-full max-h-full object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                </div>
            )}

            {/* PDF Viewer */}
            {selectedItem && selectedItem.type === 'pdf' && (
                <div
                    className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
                    onClick={() => setSelectedItem(null)}
                >
                    <button
                        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-10"
                        onClick={() => setSelectedItem(null)}
                    >
                        <X className="w-6 h-6" />
                    </button>
                    <iframe
                        src={selectedItem.url}
                        className="w-full h-full max-w-4xl rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                        title={selectedItem.name || 'PDF Viewer'}
                    />
                </div>
            )}
        </div>
    );
}

export default MediaBlockView;
