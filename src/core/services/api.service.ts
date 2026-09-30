// ============================================
// PROJECT OMNI: CONNECTION TESTS
// Settings-panel probes only. Blocks fetch through the gateway, never here —
// these deliberately call the SAME routes the blocks use, so a green test
// cannot pass while the real path is broken.
// ============================================

/**
 * Test API connection
 */
export async function testPolymarketConnection(): Promise<boolean> {
    try {
        const response = await fetch('/api/polymarket');
        const data = await response.json();
        return data.success;
    } catch {
        return false;
    }
}
