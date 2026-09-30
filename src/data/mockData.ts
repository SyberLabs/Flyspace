// ============================================
// PROJECT OMNI: MOCK DATA FOR DEVELOPMENT
// ============================================

/**
 * Simulate real-time probability updates
 */
export function generateProbabilityUpdate(currentProbability: number): number {
    const change = (Math.random() - 0.5) * 0.04; // ±2% max change
    const newProbability = currentProbability + change;
    return Math.max(0.01, Math.min(0.99, newProbability));
}
