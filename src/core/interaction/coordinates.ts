// Explicit, named transforms. Anonymous {x,y} values do not cross layers.

import type { CoordinateFrame, FramedPoint } from './types';

export function point(frame: CoordinateFrame, x: number, y: number): FramedPoint {
    return { frame, x, y };
}
