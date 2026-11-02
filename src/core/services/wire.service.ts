// ============================================
// PROJECT OMNI: WIRE SERVICE
// ============================================

import { useWireStore } from '../stores/wireStore';
import { WireFilters } from '../schemas/wire.schema';

class WireService {
    createWire(sourceBlockId: string, targetBlockId: string, filters?: Partial<WireFilters>): string {
        return useWireStore.getState().addWire(sourceBlockId, targetBlockId, filters) || '';
    }
}

export const wireService = new WireService();
