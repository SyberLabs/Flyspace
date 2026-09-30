'use client';

// ============================================
// SYBERLABS ATLAS v2: AMBIENT ATMOSPHERE
// The live Clifford-attractor plate at ambient strength, for the empty
// canvas only (one plate per view; working screens stay calm ink).
// - Lazy-loaded: the engine is fetched only when an empty state mounts.
// - Always aria-hidden and pointer-events:none, lowest layer of its host.
// - No WebGL2, or only a software rasteriser: no engine; the CSS nebula shows.
// - A fresh <canvas> per mount, because destroy() loses the GL context and a
//   lost context cannot be reused (matters under React StrictMode).
// ============================================

import { useEffect, useRef } from 'react';

const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * True only for hardware-accelerated WebGL2. A software rasteriser (no GPU,
 * headless CI, remote desktops) can run the engine, but each frame then
 * blocks the main thread for hundreds of milliseconds, so it is treated like
 * "no WebGL2": the CSS nebula shows instead.
 */
let hardwareGL: boolean | undefined;
export function hasHardwareWebGL2(): boolean {
    if (hardwareGL === undefined) hardwareGL = probeHardwareWebGL2();
    return hardwareGL;
}

function probeHardwareWebGL2(): boolean {
    try {
        const probe = document.createElement('canvas');
        const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
        if (!gl) return false;
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return !SOFTWARE_GL.test(renderer);
    } catch {
        return false;
    }
}

export function Atmosphere() {
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || !hasHardwareWebGL2()) return;
        let cancelled = false;
        let plate: { destroy(): void } | undefined;
        const canvas = document.createElement('canvas');
        canvas.className = 'canvas-atmosphere-plate';
        canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(canvas);

        import('@/vendor/syber/syber-atmosphere.js')
            .then(({ mount }) => {
                if (!cancelled) plate = mount(canvas, { mode: 'ambient' });
            })
            .catch(() => { canvas.style.display = 'none'; });

        return () => {
            cancelled = true;
            plate?.destroy();
            canvas.remove();
        };
    }, []);

    return (
        <div className="canvas-atmosphere" aria-hidden="true">
            <div ref={hostRef} className="canvas-atmosphere-host" />
            <div className="canvas-atmosphere-scrim" />
        </div>
    );
}
