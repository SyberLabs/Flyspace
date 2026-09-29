'use client';

// Spatial input lab. Camera frames are drawn as a ghost and discarded.
// Nothing on this panel calls addBlock or addWire; the session does,
// after validation.

import { useEffect, useRef, useState } from 'react';
import { spatialSession } from '@/core/interaction/session';
import { createLocalHandLandmarker, framesFromLandmarker, type HandLandmarkerLike } from '@/core/interaction/handLandmarker';
import { point } from '@/core/interaction/coordinates';
import type { HandLandmark } from '@/core/interaction/types';
import { useBlockStore } from '@/core/stores';

export function SpatialLab({ onClose }: { onClose: () => void }) {
    const blocks = useBlockStore(state => state.blocks);
    const shellId = useBlockStore(state => state.activeShellId);
    const videoRef = useRef<HTMLVideoElement>(null);
    const stopRef = useRef<(() => void) | null>(null);
    const [speech, setSpeech] = useState('');
    const [message, setMessage] = useState('Point, then speak. Ambiguous targets wait.');
    const [sensing, setSensing] = useState(false);
    const [ghost, setGhost] = useState<HandLandmark[]>([]);
    const [revision, setRevision] = useState(0);

    useEffect(() => () => stopRef.current?.(), []);

    const shellBlocks = blocks.filter(block => block.shellId === shellId);
    const snapshot = spatialSession.snapshot();

    async function toggleCamera() {
        if (sensing) {
            stopRef.current?.();
            stopRef.current = null;
            setSensing(false);
            setGhost([]);
            return;
        }
        const video = videoRef.current;
        if (!video || !navigator.mediaDevices?.getUserMedia) {
            setMessage('This browser has no camera. Speech and pointing still work.');
            return;
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
            video.srcObject = stream;
            await video.play();
            let landmarker: HandLandmarkerLike;
            try {
                landmarker = await createLocalHandLandmarker();
            } catch (error) {
                stream.getTracks().forEach(track => track.stop());
                setMessage(error instanceof Error ? error.message : 'Hand sensing is unavailable.');
                return;
            }
            let frame = 0;
            const tick = () => {
                frame = requestAnimationFrame(tick);
                const result = landmarker.detectForVideo(video, performance.now());
                const hands = framesFromLandmarker(result);
                setGhost(hands[0]?.landmarks ?? []);
                for (const hand of hands) spatialSession.observeHand(hand, performance.now());
                setRevision(value => value + 1);
            };
            frame = requestAnimationFrame(tick);
            stopRef.current = () => {
                cancelAnimationFrame(frame);
                landmarker.close?.();
                stream.getTracks().forEach(track => track.stop());
                video.srcObject = null;
                setGhost([]);
            };
            setSensing(true);
            setMessage('Camera stays in this browser. Pinch to move. Loss of tracking cancels the preview.');
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'Camera permission was refused.');
        }
    }

    function submitSpeech(event: React.FormEvent) {
        event.preventDefault();
        const command = spatialSession.speak(speech);
        setMessage(command.lifecycle === 'held' || command.lifecycle === 'refused'
            ? `${command.lifecycle}: ${command.reason}`
            : `${command.lifecycle} ${command.action}`);
        setSpeech('');
        setRevision(value => value + 1);
    }

    function markPoint(x: number, y: number) {
        spatialSession.notePoint(point('canvas', x, y), Date.now(), 'pointer');
        setMessage(`Point marked at ${Math.round(x)}, ${Math.round(y)}.`);
    }

    return (
        <aside className="absolute top-4 right-4 z-40 w-[360px] max-h-[80vh] overflow-auto rounded-2xl border border-[var(--citadel-border)] bg-[var(--citadel-surface)] p-4 shadow-xl" aria-label="Spatial input lab">
            <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium text-[var(--text-primary)]">Spatial input</h2>
                <button type="button" onClick={onClose} className="text-xs text-[var(--text-muted)]">Close</button>
            </div>
            <p className="mb-3 text-xs text-[var(--text-secondary)]" role="status">{message}</p>
            <video ref={videoRef} className="mb-2 h-28 w-full rounded-lg bg-black object-cover" muted playsInline />
            <svg viewBox="0 0 1 1" className="mb-3 h-24 w-full rounded-lg bg-[var(--citadel-void)]" aria-label="Hand ghost">
                {ghost.map(joint => (
                    <circle key={joint.joint} cx={joint.x} cy={joint.y} r={0.015} fill="var(--ice)" />
                ))}
            </svg>
            <button type="button" onClick={toggleCamera} className="mb-3 rounded-full border border-[var(--citadel-border)] px-3 py-1 text-xs">
                {sensing ? 'Stop camera' : 'Start camera'}
            </button>
            <div className="mb-3 grid grid-cols-2 gap-1">
                {shellBlocks.map(block => (
                    <button
                        key={block.instance_id}
                        type="button"
                        className="truncate rounded border border-[var(--citadel-border)] px-2 py-1 text-left text-xs"
                        onClick={() => markPoint(block.position.x + 8, block.position.y + 8)}
                    >
                        {block.schema.display_name}
                    </button>
                ))}
            </div>
            <form onSubmit={submitSpeech} className="mb-3 flex gap-2">
                <input
                    aria-label="Spoken command"
                    value={speech}
                    onChange={event => setSpeech(event.target.value)}
                    placeholder="put a researcher here"
                    className="min-w-0 flex-1 rounded border border-[var(--citadel-border)] bg-transparent px-2 py-1 text-xs"
                />
                <button type="submit" className="rounded bg-[var(--citadel-primary)] px-2 py-1 text-xs text-white">Run</button>
            </form>
            <div className="mb-3 flex gap-2">
                <button type="button" onClick={() => { spatialSession.confirm(); setRevision(value => value + 1); }} className="rounded border px-2 py-1 text-xs">Confirm</button>
                <button type="button" onClick={() => { spatialSession.cancel(); setRevision(value => value + 1); }} className="rounded border px-2 py-1 text-xs">Cancel</button>
                <button type="button" onClick={() => { spatialSession.undo(); setRevision(value => value + 1); }} className="rounded border px-2 py-1 text-xs">Undo</button>
            </div>
            <ol className="space-y-1 text-xs text-[var(--text-muted)]">
                {snapshot.traces.slice(-6).map((trace, index) => (
                    <li key={`${trace.command}-${index}`}>{trace.command} {trace.subject ?? ''}</li>
                ))}
            </ol>
            <span className="sr-only">{revision}</span>
        </aside>
    );
}
