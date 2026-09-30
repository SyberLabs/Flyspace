'use client';

// ============================================
// PROJECT OMNI: ARMORY SIDEBAR
// ============================================

import { motion } from 'framer-motion';
import {
    Search,
    TrendingUp,
    Newspaper,
    Globe,
    Activity,
    CloudSun,
    ChevronDown,
    ChevronRight,
    FileText,
    Cpu,
    Plus
} from 'lucide-react';
import { useState } from 'react';
import { blockRegistry } from '@/core/registry/BlockRegistry';
import { useCapabilityStore } from '@/core/capabilities/store';
import { OmniBlockSchema, BlockCategory } from '@/core/schemas/block.schema';
import { useUIStore } from '@/core/stores';
import { spatialSession } from '@/core/interaction/session';
import { cn } from '@/lib/utils';
import { BlockGlyph } from '@/components/blockIcons';
import { AddApiDialog } from '@/components/apis/AddApiDialog';

// Icon mapping
const CATEGORY_ICONS: Record<BlockCategory, React.ReactNode> = {
    truth: <TrendingUp className="w-4 h-4" />,
    pulse: <Newspaper className="w-4 h-4" />,
    physicality: <Globe className="w-4 h-4" />,
    model: <Activity className="w-4 h-4" />,
    workspace: <FileText className="w-4 h-4" />,
    system: <Cpu className="w-4 h-4" />,
    environment: <CloudSun className="w-4 h-4" />
};

const ARMORY_CATEGORY_ORDER: BlockCategory[] = [
    'pulse',
    'physicality',
    'environment',
    'truth',
    'workspace',
    'model',
    'system'
];

const DEFAULT_EXPANDED_CATEGORIES: BlockCategory[] = [
    'pulse',
    'physicality',
    'environment',
    'truth'
];

const CATEGORY_LABELS: Record<BlockCategory, string> = {
    truth: 'Truth Blocks',
    pulse: 'Pulse Blocks',
    physicality: 'Physicality Blocks',
    model: 'Model Blocks',
    workspace: 'Workspace Blocks',
    system: 'System Blocks',
    environment: 'Environment Blocks'
};

export function Sidebar() {
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedCategories, setExpandedCategories] = useState<BlockCategory[]>(DEFAULT_EXPANDED_CATEGORIES);
    const [addApiOpen, setAddApiOpen] = useState(false);
    // Capability installs mutate the block registry outside React. Subscribing
    // here redraws the Armory when a manifest is added or removed.
    useCapabilityStore(state => state.manifests.length);

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
        <aside className="sidebar">
            {/* Header */}
            <div className="sidebar-header">
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">The Armory</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">Drag blocks to your Canvas</p>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-[var(--citadel-border)]">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
                    <input
                        type="text"
                        placeholder="Search blocks..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-[var(--citadel-elevated)] border border-[var(--citadel-border)] rounded-lg text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--citadel-primary)]"
                    />
                </div>
            </div>

            {/* Adding an API happens in its own dialog: search results and a
                review do not fit, or scroll, inside a 280px strip. */}
            <div className="px-4 py-3 border-b border-[var(--citadel-border)]">
                <button
                    type="button"
                    onClick={() => setAddApiOpen(true)}
                    className="w-full flex items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--citadel-border)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:border-[var(--citadel-primary)] hover:text-[var(--text-primary)] transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    Add an API
                </button>
            </div>
            <AddApiDialog open={addApiOpen} onClose={() => setAddApiOpen(false)} />

            {/* Block Categories */}
            <div className="sidebar-content space-y-2">
                {ARMORY_CATEGORY_ORDER.map(category => {
                    const blocks = blocksByCategory[category] || [];
                    if (blocks.length === 0) return null;
                    const isExpanded = expandedCategories.includes(category);

                    return (
                        <div key={category} className="rounded-lg overflow-hidden">
                            {/* Category Header */}
                            <button
                                onClick={() => toggleCategory(category)}
                                className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--citadel-elevated)] hover:bg-[var(--citadel-border)]/30 transition-colors"
                            >
                                <span className="text-[var(--text-secondary)]">
                                    {CATEGORY_ICONS[category]}
                                </span>
                                <div className="flex-1 text-left">
                                    <span className="text-sm font-medium text-[var(--text-primary)]">
                                        {CATEGORY_LABELS[category]}
                                    </span>
                                    <span className="text-xs text-[var(--text-muted)] ml-2">
                                        ({blocks.length})
                                    </span>
                                </div>
                                {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />
                                ) : (
                                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
                                )}
                            </button>

                            {/* Category Blocks */}
                            {isExpanded && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="bg-[var(--citadel-surface)] border-t border-[var(--citadel-border)]"
                                >
                                    {blocks.map(block => (
                                        <BlockItem key={block.block_id} block={block} />
                                    ))}
                                </motion.div>
                            )}
                        </div>
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
}

function BlockItem({ block }: BlockItemProps) {
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
        spatialSession.pointerCreate(block.block_id, { x: 320 + offset, y: 80 + offset }, 'sidebar-click');
    };

    return (
        <div
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            className={cn(
                "cursor-grab active:cursor-grabbing",
                "border-b border-[var(--citadel-border)]/50 last:border-b-0"
            )}
        >
            <motion.div
                whileHover={{ x: 4 }}
                className={cn(
                    "flex items-center gap-3 px-3 py-2.5",
                    "hover:bg-[var(--citadel-elevated)] transition-colors"
                )}
            >
                <div className="w-8 h-8 rounded-lg bg-[var(--citadel-primary)]/10 flex items-center justify-center text-[var(--citadel-primary)]">
                    <BlockGlyph name={block.icon} className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {block.display_name}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                        {block.description}
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
