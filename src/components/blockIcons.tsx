// Shared Lucide map for Armory, canvas cards, command palette, and the
// API Command Center. A provider that is on the canvas but missing here
// falls back to Activity and looks unsupported.

import { createElement } from 'react';
import {
    Activity,
    BookOpen,
    Brain,
    Building,
    CloudSun,
    Code,
    Coins,
    DollarSign,
    FileText,
    Files,
    FlaskConical,
    Github,
    Globe,
    Image,
    Library,
    LineChart,
    MessageSquare,
    Mic,
    Newspaper,
    Palette,
    Puzzle,
    Shield,
    Swords,
    Target,
    TrendingUp,
    Users,
    Volume2,
    Zap,
    type LucideIcon
} from 'lucide-react';

export const BLOCK_ICON_COMPONENTS: Record<string, LucideIcon> = {
    Activity,
    BookOpen,
    Brain,
    Building,
    CloudSun,
    Code,
    Coins,
    DollarSign,
    FileText,
    Files,
    FlaskConical,
    Github,
    Globe,
    Image,
    Library,
    LineChart,
    MessageSquare,
    Mic,
    Newspaper,
    Palette,
    Puzzle,
    Shield,
    Swords,
    Target,
    TrendingUp,
    Users,
    Volume2,
    Zap
};

export function resolveBlockIcon(iconName?: string): LucideIcon {
    if (iconName && BLOCK_ICON_COMPONENTS[iconName]) {
        return BLOCK_ICON_COMPONENTS[iconName];
    }
    return Activity;
}

/** Look up a Lucide icon by catalog / block name without creating a component in render. */
export function BlockGlyph({ name, className }: { name?: string; className?: string }) {
    return createElement(BLOCK_ICON_COMPONENTS[name ?? ''] ?? Activity, { className });
}
