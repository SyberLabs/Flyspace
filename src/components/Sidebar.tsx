'use client';

// ============================================
// OMNIOS: BLOCK LIBRARY (sidebar)
// ============================================

import {
    Search,
    X,
    TrendingUp,
    Newspaper,
    Globe,
    Activity,
    CloudSun,
    ChevronDown,
    ChevronRight,
    FileText,
    Cpu,
    Heart,
    Briefcase,
    Wallet,
    Clock,
    User
} from 'lucide-react';
import { useState } from 'react';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { OmniBlockSchema, BlockCategory } from '@/core/schemas/block.schema';
import { useBlockStore, useUIStore } from '@/core/stores';
import { BlockGlyph } from '@/components/blockIcons';

// Icon mapping
const CATEGORY_ICONS: Record<BlockCategory, React.ReactNode> = {
    truth: <TrendingUp className="w-4 h-4" />,
    pulse: <Newspaper className="w-4 h-4" />,
    physicality: <Globe className="w-4 h-4" />,
    model: <Activity className="w-4 h-4" />,
    workspace: <FileText className="w-4 h-4" />,
    system: <Cpu className="w-4 h-4" />,
    health: <Heart className="w-4 h-4" />,
    career: <Briefcase className="w-4 h-4" />,
    finance: <Wallet className="w-4 h-4" />,
    mind_system: <Activity className="w-4 h-4" />,
    relationships: <User className="w-4 h-4" />,
    environment: <CloudSun className="w-4 h-4" />,
    time: <Clock className="w-4 h-4" />
};

const ARMORY_CATEGORY_ORDER: BlockCategory[] = [
    'pulse',
    'physicality',
    'environment',
    'truth',
    'workspace',
    'model',
    'system',
    'health',
    'career',
    'finance',
    'mind_system',
    'relationships',
    'time'
];

const DEFAULT_EXPANDED_CATEGORIES: BlockCategory[] = [
    'pulse',
    'physicality',
    'environment',
    'truth'
];

const CATEGORY_LABELS: Record<BlockCategory, string> = {
    truth: 'Markets',
    pulse: 'News',
    physicality: 'Physical world',
    model: 'Models',
    workspace: 'Workspace',
    system: 'System',
    health: 'Health Blocks',
    career: 'Career Blocks',
    finance: 'Finance Blocks',
    mind_system: 'Mind Blocks',
    relationships: 'Relationships Blocks',
    environment: 'Environment',
    time: 'Time Blocks'
};

export function Sidebar({ isOpen = false, onClose }: { isOpen?: boolean; onClose?: () => void } = {}) {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<BlockCategory[]>(DEFAULT_EXPANDED_CATEGORIES);

    const allBlocks = blockRegistry.getAll();
    const filteredBlocks = searchQuery
        ? blockRegistry.search(searchQuery)
        : allBlocks;

    // Group blocks by category
    const blocksByCategory = filteredBlocks.reduce((acc, block) => {
        if (!acc[block.category]) acc[block.category] = [];
        acc[block.category].push(block);
        return acc;
    }, {} as Record<BlockCategory, OmniBlockSchema[]>);

    const toggleCategory = (category: BlockCategory) => {
        setExpandedCategories(prev =>
            prev.includes(category)
                ? prev.filter(c => c !== category)
                : [...prev, category]
        );
    };

    return (
        <aside id="block-library" className="sidebar" data-open={isOpen} aria-label="Block library">
            <div className="sidebar-header flex items-start justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold leading-7 text-[var(--sy-text)]">Block library</h2>
                    <p className="text-sm text-[var(--sy-text-3)]">Drag a block onto the canvas, or select it to add.</p>
                </div>
                {onClose && (
                    <button type="button" onClick={onClose} className="sy-icon-btn md:hidden -mr-2 -mt-2" aria-label="Close block library">
                        <X />
                    </button>
                )}
            </div>

            <div className="px-4 pb-3">
                <label htmlFor="block-search" className="sr-only">Search blocks</label>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--sy-text-3)]" strokeWidth={1.5} aria-hidden="true" />
                    <input
                        id="block-search"
                        type="search"
                        placeholder="Search blocks"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full h-11 pl-10 pr-4 bg-[var(--sy-surface)] border border-[var(--sy-line-strong)] rounded-lg text-base text-[var(--sy-text)] placeholder:text-[var(--sy-text-3)] focus:outline-none focus:border-[var(--sy-brand)]"
                    />
                </div>
            </div>

            <div className="sidebar-content">
                {filteredBlocks.length === 0 && (
                    <div className="px-2 py-6">
                        <p className="text-base font-semibold text-[var(--sy-text)]">No blocks match</p>
                        <p className="text-sm text-[var(--sy-text-2)] mt-1">Try a source name such as Polymarket or Weather.</p>
                        <button type="button" onClick={() => setSearchQuery('')} className="btn btn-secondary mt-4">
                            Clear search
                        </button>
                    </div>
                )}
                {ARMORY_CATEGORY_ORDER.map(category => {
                    const blocks = blocksByCategory[category] || [];
                    if (blocks.length === 0) return null;
                    const isExpanded = expandedCategories.includes(category);

                    return (
                        <section key={category} className="border-t border-[var(--sy-line)] first:border-t-0">
                            <button
                                type="button"
                                onClick={() => toggleCategory(category)}
                                aria-expanded={isExpanded}
                                className="w-full h-11 flex items-center gap-3 px-2 rounded-lg text-[var(--sy-text-3)] hover:text-[var(--sy-text)] transition-colors"
                            >
                                <span aria-hidden="true">{CATEGORY_ICONS[category]}</span>
                                <span className="flex-1 text-left sy-label !text-inherit">
                                    {CATEGORY_LABELS[category]}
                                    <span className="ml-2">{blocks.length}</span>
                                </span>
                                {isExpanded ? (
                                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                                ) : (
                                    <ChevronRight className="w-4 h-4" aria-hidden="true" />
                                )}
                            </button>

                            {isExpanded && (
                                <ul className="pb-2">
                                    {blocks.map(block => (
                                        <BlockItem key={block.block_id} block={block} onAdded={onClose} />
                                    ))}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>
        </aside>
    );
}

// ============================================
// INDIVIDUAL BLOCK ITEM
// ============================================

interface BlockItemProps {
    block: OmniBlockSchema;
    /** Closes the mobile drawer once a block is added. */
    onAdded?: () => void;
}

function BlockItem({ block, onAdded }: BlockItemProps) {
    const { addBlock } = useBlockStore();
    const { setDraggingBlock } = useUIStore();

    const handleDragStart = (e: React.DragEvent) => {
        setDraggingBlock(block.block_id);
        e.dataTransfer.setData('text/plain', block.block_id);
        e.dataTransfer.effectAllowed = 'copy';
    };

    const handleDragEnd = () => {
        setDraggingBlock(null);
    };

    const handleClick = () => {
        // Quick-add to canvas at a default position
        const offset = Math.random() * 100;
        addBlock(block, { x: 320 + offset, y: 80 + offset });
        onAdded?.();
    };

    return (
        <li>
            <button
                type="button"
                draggable
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onClick={handleClick}
                title={block.description}
                className="w-full min-h-11 flex items-center gap-3 px-2 py-2 rounded-lg text-left cursor-grab active:cursor-grabbing hover:bg-[var(--sy-surface-2)] transition-colors"
            >
                <BlockGlyph name={block.icon} className="w-5 h-5 flex-none text-[var(--sy-text-3)]" />
                <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium text-[var(--sy-text)] truncate">
                        {block.display_name}
                    </span>
                    <span className="block text-xs text-[var(--sy-text-3)] truncate">
                        {block.description}
                    </span>
                </span>
            </button>
        </li>
    );
}

export default Sidebar;
