// ============================================
// PROJECT OMNI: SKIN SERVICE
// LLM-powered CSS theme generator
// ============================================

import { LLMMessage } from './llm.service';
import { runTurn } from '@/core/cognition';

// ============================================
// PRESET THEMES
// ============================================

export interface SkinTheme {
    id: string;
    name: string;
    description: string;
    variables: Record<string, string>;
}

export const PRESET_THEMES: SkinTheme[] = [
    {
        id: 'command',
        name: 'Command Center',
        description: 'High-density tactical interface',
        // SyberLabs Atlas v2. Must stay identical to :root in globals.css.
        variables: {
            '--citadel-void': '#06051a',
            '--citadel-surface': '#0c0a2a',
            '--citadel-elevated': '#141238',
            '--citadel-border': 'rgba(170, 180, 255, 0.16)',
            '--citadel-primary': '#4890f0',
            '--citadel-primary-glow': '#9a6bff',
            '--citadel-secondary': '#90d8f0',
            '--citadel-accent': '#f59be0',
            '--text-primary': '#eef0ff',
            '--text-secondary': '#b4bbe2',
            '--text-muted': '#8990bb'
        }
    },
    {
        id: 'journal',
        name: 'Renaissance Journal',
        description: 'Warm, scholarly aesthetic',
        variables: {
            '--citadel-void': '#1a1612',
            '--citadel-surface': '#2a2420',
            '--citadel-elevated': '#3a342e',
            '--citadel-border': '#5a4a3a',
            '--citadel-primary': '#d4a574',
            '--citadel-primary-glow': '#e8c4a0',
            '--citadel-secondary': '#8b7355',
            '--citadel-accent': '#c9a87c',
            '--text-primary': '#f5ebe0',
            '--text-secondary': '#d4c4b0',
            '--text-muted': '#a08060'
        }
    },
    {
        id: 'cybernetic',
        name: 'Cybernetic Grid',
        description: 'Neon-lit network visualization',
        variables: {
            '--citadel-void': '#050510',
            '--citadel-surface': '#0a0a1a',
            '--citadel-elevated': '#101025',
            '--citadel-border': '#1a1a40',
            '--citadel-primary': '#00ffaa',
            '--citadel-primary-glow': '#00ff88',
            '--citadel-secondary': '#ff00aa',
            '--citadel-accent': '#00aaff',
            '--text-primary': '#e0ffe0',
            '--text-secondary': '#80ff80',
            '--text-muted': '#40aa40'
        }
    },
    {
        id: 'minimal',
        name: 'Minimal Light',
        description: 'Clean, sparse interface',
        variables: {
            '--citadel-void': '#fafafa',
            '--citadel-surface': '#ffffff',
            '--citadel-elevated': '#f5f5f5',
            '--citadel-border': '#e0e0e0',
            '--citadel-primary': '#2563eb',
            '--citadel-primary-glow': '#3b82f6',
            '--citadel-secondary': '#0891b2',
            '--citadel-accent': '#7c3aed',
            '--text-primary': '#171717',
            '--text-secondary': '#525252',
            '--text-muted': '#a3a3a3'
        }
    }
];

// ============================================
// SKIN GENERATION PROMPT
// ============================================

const SKIN_SYSTEM_PROMPT = `You are a UI theme designer for "The Citadel", a cognitive command center application.
Your task is to generate CSS custom property (variable) values based on the user's aesthetic description.

You must output ONLY a valid JSON object with CSS variable names as keys and color values as values.
Use hex colors (e.g., #1a1a24) or rgba for transparency.

The variables you can set are:
- --citadel-void: The darkest background (void/outer space)
- --citadel-surface: Primary surface background
- --citadel-elevated: Elevated surface (cards, modals)
- --citadel-border: Border color
- --citadel-primary: Primary accent color
- --citadel-primary-glow: Hover/glow state of primary
- --citadel-secondary: Secondary accent
- --citadel-accent: Tertiary accent
- --text-primary: Main text color
- --text-secondary: Secondary text
- --text-muted: Muted/disabled text
- --truth-green: Success/positive color
- --truth-red: Error/negative color
- --truth-amber: Warning color

Consider color theory, contrast ratios for readability, and the emotional tone requested.

Example output:
{
  "--citadel-void": "#0f0f14",
  "--citadel-surface": "#1a1a24",
  "--citadel-primary": "#8b5cf6",
  "--text-primary": "#f4f4f5"
}`;

// ============================================
// SKIN SERVICE
// ============================================

export interface SkinGenerationResult {
    success: boolean;
    variables?: Record<string, string>;
    error?: string;
}

class SkinService {
    /**
     * Generate a custom skin from a natural language prompt
     */
    async generateSkin(prompt: string): Promise<SkinGenerationResult> {
        try {
            const messages: LLMMessage[] = [
                { role: 'system', content: SKIN_SYSTEM_PROMPT },
                { role: 'user', content: `Create a theme based on: "${prompt}"` }
            ];

            // The Cognition Kernel owns the turn lifecycle (apex A4).
            const response = await runTurn(messages, { temperature: 0.7, maxTokens: 1000 });
            if (!response.success) {
                return { success: false, error: response.error };
            }

            // Parse the JSON response
            const variables = this.parseVariables(response.content);

            if (Object.keys(variables).length === 0) {
                return {
                    success: false,
                    error: 'Failed to parse theme variables from LLM response'
                };
            }

            return {
                success: true,
                variables
            };
        } catch (error) {
            return {
                success: false,
                error: (error as Error).message
            };
        }
    }

    /**
     * Parse CSS variables from LLM response
     */
    private parseVariables(response: string): Record<string, string> {
        const variables: Record<string, string> = {};

        try {
            // Try to extract JSON from the response
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);

                // Validate and filter to only allowed CSS variables
                const allowedVars = [
                    '--citadel-void', '--citadel-surface', '--citadel-elevated', '--citadel-border',
                    '--citadel-primary', '--citadel-primary-glow', '--citadel-secondary', '--citadel-accent',
                    '--text-primary', '--text-secondary', '--text-muted',
                    '--truth-green', '--truth-red', '--truth-amber'
                ];

                for (const [key, value] of Object.entries(parsed)) {
                    if (allowedVars.includes(key) && typeof value === 'string') {
                        // Basic validation: must look like a color
                        if (value.match(/^#[0-9a-fA-F]{3,8}$/) || value.match(/^rgba?\(/)) {
                            variables[key] = value;
                        }
                    }
                }
            }
        } catch {
            console.warn('Failed to parse LLM response as JSON');
        }

        return variables;
    }

    /**
     * Apply a theme to the document
     */
    applyTheme(variables: Record<string, string>): void {
        const root = document.documentElement;

        for (const [key, value] of Object.entries(variables)) {
            root.style.setProperty(key, value);
        }
    }

    /**
     * Reset to default theme
     */
    resetTheme(): void {
        const root = document.documentElement;
        const defaultVars = PRESET_THEMES[0].variables;

        // Reset all skinnable variables to defaults
        for (const key of Object.keys(defaultVars)) {
            root.style.removeProperty(key);
        }
    }
}

// Singleton instance
let skinServiceInstance: SkinService | null = null;

export function getSkinService(): SkinService {
    if (!skinServiceInstance) {
        skinServiceInstance = new SkinService();
    }
    return skinServiceInstance;
}
