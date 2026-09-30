// ============================================
// PROJECT OMNI: MIND-SHELL SYNC HOOK
// Bridges the cognitive substrate with the interface layer
// ============================================

import { useEffect, useRef } from 'react';
import { useBlockStore, useMindStore } from '../stores';

/**
 * Hook to automatically sync Shell block data changes to the Mind system
 * Place this at the app root level to enable continuous Mind-Shell sync
 */
export function useMindShellSync() {
    const blocks = useBlockStore(state => state.blocks);
    const mindStatus = useMindStore(state => state.status);
    const extractBlockEntities = useMindStore(state => state.extractBlockEntities);
    const updateAwareness = useMindStore(state => state.updateAwareness);
    const initialize = useMindStore(state => state.initialize);

    // Track last seen data per block to avoid duplicate ingestion
    const lastDataRef = useRef<Map<string, unknown>>(new Map());

    // Initialize Mind on mount
    useEffect(() => {
        if (mindStatus === 'offline') {
            initialize();
        }
    }, [mindStatus, initialize]);

    // Sync block data changes to Mind
    useEffect(() => {
        if (mindStatus !== 'ready') return;

        const changedTypes = new Set<string>();

        for (const block of blocks) {
            // Skip blocks with no data
            if (!block.data) continue;

            // Check if data has changed
            const lastData = lastDataRef.current.get(block.instance_id);
            if (lastData === block.data) continue;

            // Update tracker
            lastDataRef.current.set(block.instance_id, block.data);

            // Extract entities for knowledge graph (per block)
            extractBlockEntities(
                block.instance_id,
                block.schema.block_id,
                block.data
            );

            // Mark type for awareness update
            changedTypes.add(block.schema.block_id);
        }

        // Update awareness for changed types (aggregation)
        if (changedTypes.size > 0) {
            import('../stores/mindStore').then(({ summarizeBlockData }) => {
                for (const type of changedTypes) {
                    // Gather data from ALL blocks of this type
                    const typeBlocks = blocks.filter(b => b.schema.block_id === type && b.data);

                    let combinedData: unknown[] = [];
                    for (const b of typeBlocks) {
                        if (Array.isArray(b.data)) {
                            combinedData = [...combinedData, ...b.data];
                        } else {
                            combinedData.push(b.data);
                        }
                    }

                    // Generate aggregate summary
                    const summary = summarizeBlockData(type, combinedData);

                    // Update awareness pool
                    updateAwareness(type, summary);
                }
            });
        }

        // Clean up removed blocks from tracker
        const currentIds = new Set(blocks.map(b => b.instance_id));
        for (const id of lastDataRef.current.keys()) {
            if (!currentIds.has(id)) {
                lastDataRef.current.delete(id);
            }
        }
    }, [blocks, mindStatus, extractBlockEntities, updateAwareness]);

    return {
        isSyncing: mindStatus === 'ready',
        mindStatus
    };
}
