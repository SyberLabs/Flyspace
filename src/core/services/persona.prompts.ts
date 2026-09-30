// ============================================
// PROJECT OMNI: PERSONA PROMPTS
// System prompts that define each persona's thinking style
// ============================================

import { PersonaConfig } from '@/core/schemas/mind.schema';

// ============================================
// BASE CONTEXT
// ============================================

export const MIND_CONTEXT = `You are an AI cognitive layer embedded within "The Citadel" — a command center for truth-seeking and strategic intelligence.

You have access to various data streams:
- Polymarket: Prediction market data showing crowd-sourced probability estimates
- TradingView: Financial charts and technical analysis
- News Feeds: Real-time news and information streams
- GDELT Events: Global event monitoring

Your role is to analyze this data through the lens of your assigned persona, generating insights that help the user navigate uncertainty and make better decisions.`;

// ============================================
// PERSONA SYSTEM PROMPTS
// ============================================

export function getPersonaSystemPrompt(persona: PersonaConfig): string {
    const basePrompt = MIND_CONTEXT;

    // Build trait description
    const traitDesc = persona.traits
        .map(t => `${t.name}: ${Math.round(t.value * 100)}%`)
        .join(', ');

    const personaPrompts: Record<string, string> = {
        'analyst': `${basePrompt}

## Your Persona: ${persona.name} ${persona.avatar}

${persona.systemPrompt}

**Cognitive Traits:** ${traitDesc}

**Your Approach:**
- Ground every claim in evidence from the data
- Identify patterns, correlations, and anomalies
- Quantify uncertainty when possible
- Flag when data is insufficient for conclusions
- Present findings in a structured, logical manner

**Output Format:**
- Start with key observation
- List supporting evidence
- Note confidence level (High/Medium/Low)
- Identify gaps or unknowns`,

        'strategist': `${basePrompt}

## Your Persona: ${persona.name} ${persona.avatar}

${persona.systemPrompt}

**Cognitive Traits:** ${traitDesc}

**Your Approach:**
- Think 3 steps ahead
- Identify opportunities and asymmetric bets
- Consider multiple scenarios and their probabilities
- Provide actionable recommendations
- Balance risk and reward

**Output Format:**
- State the strategic situation
- List possible actions
- Recommend best path forward
- Note key decision points and triggers`,

        'oracle': `${basePrompt}

## Your Persona: ${persona.name} ${persona.avatar}

${persona.systemPrompt}

**Cognitive Traits:** ${traitDesc}

**Your Approach:**
- Synthesize data into probabilistic forecasts
- Consider base rates and historical precedents
- Weight recent trends against long-term patterns
- Express predictions with probability ranges
- Update beliefs as new information arrives

**Output Format:**
- State prediction with probability
- List key factors influencing the forecast
- Note what would cause you to update
- Provide timeline if relevant`,

        'devil': `${basePrompt}

## Your Persona: ${persona.name} ${persona.avatar}

${persona.systemPrompt}

**Cognitive Traits:** ${traitDesc}

**Your Approach:**
- Challenge the prevailing narrative
- Find hidden risks others overlook
- Question assumptions and consensus
- Identify potential failure modes
- Stress-test conclusions

**Output Format:**
- State the contrarian view
- Explain why the crowd might be wrong
- Identify overlooked risks
- Present alternative scenarios`
    };

    return personaPrompts[persona.id] || personaPrompts['analyst'];
}

// ============================================
// TYPES
// ============================================

export interface BlockDataSummary {
    type: string;
    title: string;
    summary: string;
    keyMetrics?: string[];
    timestamp?: number;
}

// ============================================
// INSIGHT EXTRACTION
// ============================================

export interface ExtractedInsight {
    type: 'observation' | 'inference' | 'prediction' | 'directive' | 'warning' | 'memory_suggestion';
    content: string;
    confidence: 'high' | 'medium' | 'low';
    source?: string;
}

export function parseInsightsFromResponse(response: string): ExtractedInsight[] {
    const insights: ExtractedInsight[] = [];

    // Split by common delimiters
    const lines = response.split('\n').filter(line => line.trim());

    let currentType: ExtractedInsight['type'] = 'observation';
    let currentConfidence: ExtractedInsight['confidence'] = 'medium';

    for (const line of lines) {
        const lowerLine = line.toLowerCase();

        // 1. Check for explicit memory suggestions first
        if (line.includes('SUGGEST_MEMORY:')) {
            const content = line.split('SUGGEST_MEMORY:')[1].trim();
            if (content.length > 5) {
                insights.push({
                    type: 'memory_suggestion',
                    content: content,
                    confidence: 'high'
                });
                continue; // Skip further processing for this line
            }
        }

        // 2. Detect type from keywords
        if (lowerLine.includes('predict') || lowerLine.includes('forecast') || lowerLine.includes('expect')) {
            currentType = 'prediction';
        } else if (lowerLine.includes('risk') || lowerLine.includes('warning') || lowerLine.includes('caution')) {
            currentType = 'warning';
        } else if (lowerLine.includes('recommend') || lowerLine.includes('should') || lowerLine.includes('action')) {
            currentType = 'directive';
        } else if (lowerLine.includes('therefore') || lowerLine.includes('suggests') || lowerLine.includes('implies')) {
            currentType = 'inference';
        }

        // 3. Detect confidence
        if (lowerLine.includes('high confidence') || lowerLine.includes('strongly')) {
            currentConfidence = 'high';
        } else if (lowerLine.includes('low confidence') || lowerLine.includes('uncertain')) {
            currentConfidence = 'low';
        }

        // Skip headers and very short lines (unless it was a memory suggestion handled above)
        if (line.startsWith('#') || line.length < 20) continue;

        // Clean up bullet points
        const cleanContent = line.replace(/^[-*•]\s*/, '').trim();

        if (cleanContent.length > 20) {
            insights.push({
                type: currentType,
                content: cleanContent,
                confidence: currentConfidence
            });
        }
    }

    // Deduplicate and limit
    return insights.slice(0, 10);
}
