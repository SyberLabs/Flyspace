'use client';

// ============================================
// SYBERLABS ATLAS v2: PRODUCT SIGIL
// A de Jong attractor seeded by the product name (same name, same mark
// everywhere). Static once drawn; the kit is lazy-loaded so it never weighs
// on first load, and the canvas is decorative (aria-hidden).
// ============================================

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export function Sigil({ size, className }: { size: number; className?: string }) {
    const ref = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = ref.current;
        if (!canvas) return;
        let cancelled = false;
        let handle: { cancel(): void } | undefined;
        import('@/vendor/syber/syber-sigil.js')
            .then(({ draw }) => {
                if (!cancelled) handle = draw(canvas, 'OmniOS', { color: '#f59be0', animate: true });
            })
            .catch(() => { /* decorative: a missing mark is not an error state */ });
        return () => {
            cancelled = true;
            handle?.cancel();
        };
    }, []);

    return (
        <canvas
            ref={ref}
            aria-hidden="true"
            className={cn('block pointer-events-none', className)}
            style={{ width: size, height: size }}
        />
    );
}
