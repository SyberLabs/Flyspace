// Types for the vendored SyberLabs Atlas v2 kit (syber-sigil.js, unmodified).
export interface SigilParams {
    P: [number, number, number, number];
    box: [number, number, number];
    caption: string;
}

export function params(name: string): SigilParams;

export function draw(
    canvas: HTMLCanvasElement,
    name: string,
    opts?: { color?: string; animate?: boolean }
): { P: SigilParams['P']; caption: string; cancel(): void };

export function drawAll(root?: ParentNode): { disconnect(): void };
