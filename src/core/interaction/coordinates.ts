// Explicit, named transforms. Anonymous {x,y} values do not cross layers.

import type { CoordinateFrame, FramedPoint } from './types';

export interface Viewport {
    width: number;
    height: number;
    panX: number;
    panY: number;
    zoom: number;
}

export function point(frame: CoordinateFrame, x: number, y: number, z?: number): FramedPoint {
    return z === undefined ? { frame, x, y } : { frame, x, y, z };
}

/** Webcam prototype: normalized camera X/Y into canvas space. Z is not room depth. */
export function cameraNormalizedToCanvas(camera: FramedPoint, viewport: Viewport): FramedPoint {
    if (camera.frame !== 'camera_normalized') {
        throw new Error(`Expected camera_normalized, received ${camera.frame}`);
    }
    const viewportX = camera.x * viewport.width;
    const viewportY = camera.y * viewport.height;
    return point(
        'canvas',
        (viewportX - viewport.panX) / viewport.zoom,
        (viewportY - viewport.panY) / viewport.zoom,
        camera.z
    );
}
