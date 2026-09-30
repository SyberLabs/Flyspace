// Shared Lucide map for Armory, canvas cards, and command palette. A block
// that is on the canvas but missing here falls back to Activity and looks
// unsupported.

import { createElement } from 'react';
import {
    Activity,
    BookOpen,
    Brain,
    Briefcase,
    Building,
    Clock,
    CloudSun,
    Code,
    Coins,
    Cpu,
    DollarSign,
    FileText,
    Files,
    FlaskConical,
    Github,
    Globe,
    Heart,
    Hexagon,
    Home,
    Image,
    Library,
    LineChart,
    Maximize,
    MessageSquare,
    Mic,
    Newspaper,
    Palette,
    Plane,
    Puzzle,
    Shield,
    Ship,
    Swords,
    Target,
    TrendingUp,
    User,
    Users,
    Volume2,
    Wallet,
    Zap,
    type LucideIcon
} from 'lucide-react';

export const BLOCK_ICON_COMPONENTS: Record<string, LucideIcon> = {
    Activity,
    BookOpen,
    Brain,
    Briefcase,
    Building,
    Clock,
    CloudSun,
    Code,
    Coins,
    Cpu,
    DollarSign,
    FileText,
    Files,
    FlaskConical,
    Github,
    Globe,
    Heart,
    Hexagon,
    Home,
    Image,
    Library,
    LineChart,
    Maximize,
    MessageSquare,
    Mic,
    Newspaper,
    Palette,
    Plane,
    Puzzle,
    Shield,
    Ship,
    Swords,
    Target,
    TrendingUp,
    User,
    Users,
    Volume2,
    Wallet,
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
