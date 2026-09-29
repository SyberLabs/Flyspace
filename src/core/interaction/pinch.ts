// Spatial intent is temporal state. Activation and release use different
// thresholds so a hand hovering on the boundary does not flicker.

import type { HandLandmark, Vec3 } from './types';

export const PINCH_ACTIVATE_DISTANCE = 0.08;
export const PINCH_RELEASE_DISTANCE = 0.14;
export const PINCH_STABLE_MS = 120;

export type PinchPhase = 'inactive' | 'candidate' | 'active' | 'end' | 'cancel';

export interface PinchMachine {
    phase: PinchPhase;
    startedAt: number | null;
    anchor: Vec3 | null;
    handId: string;
}

export function initialPinch(handId: string): PinchMachine {
    return { phase: 'inactive', startedAt: null, anchor: null, handId };
}

export function landmarkDistance(a: HandLandmark, b: HandLandmark): number {
    const dz = (a.z ?? 0) - (b.z ?? 0);
    return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

/** MediaPipe joint 4 is the thumb tip and joint 8 is the index tip. */
export function pinchSpan(landmarks: HandLandmark[]): number | null {
    const thumb = landmarks.find(joint => joint.joint === 'thumb_tip' || joint.joint === '4');
    const index = landmarks.find(joint => joint.joint === 'index_tip' || joint.joint === '8');
    if (!thumb || !index) return null;
    return landmarkDistance(thumb, index);
}

export function stepPinch(
    state: PinchMachine,
    sample: { distance: number | null; at: number; anchor: Vec3; tracking: boolean }
): PinchMachine {
    if (!sample.tracking || sample.distance == null) {
        if (state.phase === 'active' || state.phase === 'candidate') {
            return { ...state, phase: 'cancel', anchor: state.anchor };
        }
        return initialPinch(state.handId);
    }

    const pinched = sample.distance <= PINCH_ACTIVATE_DISTANCE;
    const released = sample.distance >= PINCH_RELEASE_DISTANCE;

    if (state.phase === 'inactive' || state.phase === 'end' || state.phase === 'cancel') {
        if (!pinched) return initialPinch(state.handId);
        return { phase: 'candidate', startedAt: sample.at, anchor: sample.anchor, handId: state.handId };
    }

    if (state.phase === 'candidate') {
        if (!pinched) return initialPinch(state.handId);
        const held = sample.at - (state.startedAt ?? sample.at);
        if (held >= PINCH_STABLE_MS) {
            return { phase: 'active', startedAt: state.startedAt, anchor: state.anchor ?? sample.anchor, handId: state.handId };
        }
        return state;
    }

    if (released) {
        return { phase: 'end', startedAt: state.startedAt, anchor: state.anchor, handId: state.handId };
    }
    return { ...state, anchor: sample.anchor };
}
