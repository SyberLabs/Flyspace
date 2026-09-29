// ============================================
// WP-OMNI-03 — modality-neutral spatial types.
// Sensor output is evidence. A command is what validation admitted.
// ============================================

export type InputModality =
    | 'pointer'
    | 'touch'
    | 'speech'
    | 'camera_hand'
    | 'webxr_hand'
    | 'pen';

export type CoordinateFrame =
    | 'camera_normalized'
    | 'hand_relative'
    | 'viewport_px'
    | 'canvas'
    | 'block_local'
    | 'xr_world';

export interface Vec3 {
    x: number;
    y: number;
    z?: number;
}

export interface FramedPoint {
    frame: CoordinateFrame;
    x: number;
    y: number;
    z?: number;
}

export interface ObservationEvent<T> {
    id: string;
    modality: InputModality;
    timestampMs: number;
    confidence?: number;
    frame: CoordinateFrame;
    payload: T;
}

export interface HandLandmark {
    joint: string;
    x: number;
    y: number;
    z?: number;
    confidence?: number;
}

export interface HandObservationFrame {
    handId: string;
    handedness?: 'left' | 'right';
    trackingConfidence: number;
    landmarks: HandLandmark[];
    coordinateSpace: 'camera_normalized' | 'hand_relative_world' | 'xr_world';
}

export type SpatialPrimitive =
    | { kind: 'point'; handId?: string; at: FramedPoint; confidence: number; timestampMs: number }
    | { kind: 'pinch'; handId: string; phase: 'begin' | 'hold' | 'end' | 'cancel'; anchor: Vec3; confidence: number; startedAt: number }
    | { kind: 'grab'; handId: string; phase: 'begin' | 'hold' | 'end' | 'cancel'; anchor: Vec3; confidence: number; startedAt: number }
    | { kind: 'path'; handId?: string; points: FramedPoint[]; confidence: number; timestampMs: number }
    | { kind: 'region'; handId?: string; polygon: FramedPoint[]; confidence: number; timestampMs: number }
    | { kind: 'span'; from: FramedPoint; to: FramedPoint; confidence: number; timestampMs: number };

export type SpatialAction =
    | 'select'
    | 'create'
    | 'place'
    | 'move'
    | 'group'
    | 'ungroup'
    | 'connect'
    | 'disconnect'
    | 'compare'
    | 'annotate'
    | 'branch'
    | 'crystallize'
    | 'delete'
    | 'separate'
    | 'cancel'
    | 'undo';

export interface EntityRef {
    id: string;
}

export interface MultimodalInteractionProposal {
    id: string;
    action: SpatialAction;
    subjects: EntityRef[];
    target?: EntityRef;
    create?: { blockId: string; displayName: string };
    geometry?: {
        point?: FramedPoint;
        vector?: Vec3;
        path?: FramedPoint[];
        region?: FramedPoint[];
        transform?: { dx: number; dy: number };
    };
    evidence: string[];
    confidence: number;
    timestampMs: number;
    destructive?: boolean;
}

export type CommandLifecycle =
    | 'observed'
    | 'proposed'
    | 'resolved'
    | 'validated'
    | 'previewing'
    | 'held'
    | 'committed'
    | 'refused'
    | 'cancelled'
    | 'superseded'
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
