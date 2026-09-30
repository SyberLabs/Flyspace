// ============================================
// WP-OMNI-03 — modality-neutral spatial types.
// Sensor output is evidence. A command is what validation admitted.
// ============================================

export type InputModality = 'pointer' | 'speech';

export type CoordinateFrame = 'canvas';

export interface FramedPoint {
    frame: CoordinateFrame;
    x: number;
    y: number;
}

export type SpatialAction =
    | 'select'
    | 'create'
    | 'move'
    | 'group'
    | 'connect'
    | 'compare'
    | 'branch'
    | 'crystallize'
    | 'delete'
    | 'separate'
    | 'cancel'
    | 'undo'
    | 'open-shell';

interface EntityRef {
    id: string;
}

export interface MultimodalInteractionProposal {
    id: string;
    action: SpatialAction;
    subjects: EntityRef[];
    target?: EntityRef;
    create?: { blockId: string; displayName: string };
    geometry?: { point?: FramedPoint };
    evidence: string[];
    confidence: number;
    timestampMs: number;
}

export type CommandLifecycle =
    | 'previewing'
    | 'held'
    | 'committed'
    | 'refused'
    | 'cancelled'
    | 'undone';

export interface SpatialCommand {
    id: string;
    proposalId: string;
    action: SpatialAction;
    subjects: string[];
    target?: string;
    create?: { blockId: string; displayName: string };
    geometry?: MultimodalInteractionProposal['geometry'];
    evidence: string[];
    modalities: InputModality[];
    confidence: number;
    lifecycle: CommandLifecycle;
    reason?: string;
    summary?: string;
    shellId: string;
    timestampMs: number;
}

export interface InteractionTrace {
    command: string;
    subject?: string;
    subjects?: string[];
    target?: string;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
    modalities: InputModality[];
    committedAt: number;
}

export interface CanvasBlockView {
    id: string;
    shellId: string;
    blockId: string;
    name: string;
    tags: string[];
    x: number;
    y: number;
    width: number;
    height: number;
}
