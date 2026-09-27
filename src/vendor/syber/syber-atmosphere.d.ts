// Types for the vendored SyberLabs Atlas v2 kit (syber-atmosphere.js, unmodified).
export interface AtmosphereOptions {
    mode?: 'hero' | 'ambient';
    avoid?: Element | null;
    caption?: Element | null;
    reduced?: boolean;
}

export function mount(
    canvas: HTMLCanvasElement,
    opts?: AtmosphereOptions
): { supported: boolean; destroy(): void };

export const paramLine: (P: number[]) => string;
export const RING_SVG: string;
