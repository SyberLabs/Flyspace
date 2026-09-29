// Local hand landmarker. Frames stay in the worker/page. This module
// never writes video and never calls the canvas stores.

import type { HandLandmark, HandObservationFrame } from './types';

export interface LandmarkerResult {
    landmarks: Array<Array<{ x: number; y: number; z: number }>>;
    worldLandmarks?: Array<Array<{ x: number; y: number; z: number }>>;
    handedness?: Array<Array<{ categoryName?: string; score?: number }>>;
}

const JOINTS = [
    'wrist',
    'thumb_cmc',
    'thumb_mcp',
    'thumb_ip',
    'thumb_tip',
    'index_mcp',
    'index_pip',
    'index_dip',
    'index_tip'
];

export function framesFromLandmarker(result: LandmarkerResult): HandObservationFrame[] {
    return result.landmarks.map((hand, index) => {
        const handed = result.handedness?.[index]?.[0];
        const name = handed?.categoryName?.toLowerCase();
        const landmarks: HandLandmark[] = hand.map((joint, jointIndex) => ({
            joint: JOINTS[jointIndex] ?? String(jointIndex),
            x: joint.x,
            y: joint.y,
            z: joint.z
        }));
        return {
            handId: `camera-${index}`,
            handedness: name === 'left' || name === 'right' ? name : undefined,
            trackingConfidence: handed?.score ?? 0,
            landmarks,
            coordinateSpace: 'camera_normalized'
        };
    });
}

export interface HandLandmarkerLike {
    detectForVideo(video: HTMLVideoElement, timestampMs: number): LandmarkerResult;
    close?: () => void;
}

/**
 * Loads MediaPipe in-page. The model files may be fetched once; video frames
 * are not uploaded. If the runtime is unavailable the caller must keep the
 * lab in a non-sensing state.
 */
export async function createLocalHandLandmarker(): Promise<HandLandmarkerLike> {
    const vision = await import('@mediapipe/tasks-vision');
    const files = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
    );
    const landmarker = await vision.HandLandmarker.createFromOptions(files, {
        baseOptions: {
            modelAssetPath:
                'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    return {
        detectForVideo(video, timestampMs) {
            return landmarker.detectForVideo(video, timestampMs);
        },
        close() {
            landmarker.close();
        }
    };
}
