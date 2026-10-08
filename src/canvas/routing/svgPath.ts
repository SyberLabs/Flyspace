// SVG path for an orthogonal polyline: rounded corners, and a small
// semicircular hop wherever this wire jumps over another.

import type { Point } from './types';

export interface PathStyle {
    cornerRadius: number;
    hopRadius: number;
}

export const DEFAULT_PATH_STYLE: PathStyle = { cornerRadius: 6, hopRadius: 4 };

const EPS = 1e-6;

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

function dist(a: Point, b: Point): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Unit step from a toward b on an axis-aligned segment. */
function unit(a: Point, b: Point): Point {
    const d = dist(a, b) || 1;
    return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

export function polylineToPath(points: Point[], hops: Point[] = [], style: PathStyle = DEFAULT_PATH_STYLE): string {
    if (points.length === 0) return '';
    const n = points.length;
    // Corner radius at each interior point, limited by half of each adjacent run.
    const radius = points.map((p, i) => {
        if (i === 0 || i === n - 1) return 0;
        return Math.max(0, Math.min(style.cornerRadius, dist(points[i - 1], p) / 2, dist(p, points[i + 1]) / 2));
    });

    let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`;
    for (let i = 0; i + 1 < n; i++) {
        const a = points[i];
        const b = points[i + 1];
        const u = unit(a, b);
        const from = radius[i];
        const to = radius[i + 1];
        const len = dist(a, b);

        if (Math.abs(a.y - b.y) < EPS && hops.length) {
            const hr = style.hopRadius;
            const here = hops
                .filter(h => Math.abs(h.y - a.y) < EPS)
                .map(h => (h.x - a.x) * u.x)
                .filter(t => t > from + hr && t < len - to - hr)
                .sort((p, q) => p - q);
            let lastEnd = -Infinity;
            for (const t of here) {
                if (t - hr < lastEnd) continue; // two hops would overlap; one is enough
                const x0 = a.x + u.x * (t - hr);
                const x1 = a.x + u.x * (t + hr);
                // Bulge upward: clockwise when travelling right, counter-clockwise when left.
                d += ` L ${fmt(x0)} ${fmt(a.y)} A ${fmt(hr)} ${fmt(hr)} 0 0 ${u.x > 0 ? 1 : 0} ${fmt(x1)} ${fmt(a.y)}`;
                lastEnd = t + hr;
            }
        }

        if (i + 1 === n - 1) {
            d += ` L ${fmt(b.x)} ${fmt(b.y)}`;
        } else {
            const c = points[i + 2];
            const v = unit(b, c);
            d += ` L ${fmt(b.x - u.x * to)} ${fmt(b.y - u.y * to)}`;
            if (to > 0) d += ` Q ${fmt(b.x)} ${fmt(b.y)} ${fmt(b.x + v.x * to)} ${fmt(b.y + v.y * to)}`;
        }
    }
    return d;
}

/** The point halfway along a polyline, for labels. */
export function midpoint(points: Point[]): Point {
    if (points.length === 0) return { x: 0, y: 0 };
    let total = 0;
    for (let i = 0; i + 1 < points.length; i++) total += dist(points[i], points[i + 1]);
    let left = total / 2;
    for (let i = 0; i + 1 < points.length; i++) {
        const len = dist(points[i], points[i + 1]);
        if (left <= len) {
            const u = unit(points[i], points[i + 1]);
            return { x: points[i].x + u.x * left, y: points[i].y + u.y * left };
        }
        left -= len;
    }
    return points[points.length - 1];
}
