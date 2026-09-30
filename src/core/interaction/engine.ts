// One commit boundary for pointer, speech, camera, and later XR.
// Adapters never call the canvas stores.

import type { BlockInstance } from '@/core/schemas/block.schema';
import { evaluateWireAdmission } from './ports';
import { clearSeparated, isSeparated, markSeparated } from './separation';
import { defaultSpeechCatalog, parseSpeech, type SpeechCatalog, type SpeechIntent, type SpeechShellKind } from './speech';
import { describeCommand } from './speechReply';
import { resolveReferents } from './referent';
import { stepPinch, pinchSpan, initialPinch, type PinchMachine } from './pinch';
import { cameraNormalizedToCanvas, point, type Viewport } from './coordinates';
import type {
    CanvasBlockView,
    CommandLifecycle,
    FramedPoint,
    HandObservationFrame,
    InputModality,
    InteractionTrace,
    MultimodalInteractionProposal,
    SpatialCommand
} from './types';

export interface CanvasMutator {
    listBlocks(): CanvasBlockView[];
    getInstance(id: string): BlockInstance | undefined;
    activeShell(): string;
    move(id: string, x: number, y: number): { x: number; y: number };
    add(blockId: string, displayName: string, x: number, y: number): string;
    remove(id: string): BlockInstance | undefined;
    restore(block: BlockInstance): void;
    connect(sourceId: string, targetId: string): { ok: true; wireId: string } | { ok: false; reason: string };
    disconnect(wireId: string): void;
    setGroup(ids: string[], groupId: string | null): void;
    openShell(target: SpeechShellKind): { ok: true; name: string; previousShellId: string } | { ok: false; reason: string };
}

interface UndoEntry {
    commandId: string;
    apply: () => void;
}

export interface EngineSnapshot {
    commands: SpatialCommand[];
    traces: InteractionTrace[];
    preview: SpatialCommand | null;
    held: SpatialCommand | null;
    groups: Record<string, string[]>;
}

let sequence = 0;
function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}_${sequence}`;
}

export class InteractionEngine {
    private commands: SpatialCommand[] = [];
    private traces: InteractionTrace[] = [];
    private undoStack: UndoEntry[] = [];
    private preview: SpatialCommand | null = null;
    private held: SpatialCommand | null = null;
    private selection: string[] = [];
    private recentInteraction: string[] = [];
    private recentDiscourse: string[] = [];
    private points: Array<{ at: FramedPoint; timestampMs: number; modality: InputModality }> = [];
    private groups = new Map<string, string[]>();
    private pinches = new Map<string, PinchMachine>();
    private activeMove: { subject: string; origin: { x: number; y: number } } | null = null;
    private viewport: Viewport = { width: 1280, height: 720, panX: 0, panY: 0, zoom: 1 };

    constructor(
        private readonly canvas: CanvasMutator,
        private readonly catalog: () => SpeechCatalog = defaultSpeechCatalog
    ) {}

    setViewport(viewport: Viewport): void {
        this.viewport = viewport;
    }

    snapshot(): EngineSnapshot {
        return {
            commands: this.commands.map(command => ({ ...command, subjects: [...command.subjects], evidence: [...command.evidence], modalities: [...command.modalities], summary: command.summary })),
            traces: this.traces.map(trace => ({ ...trace })),
            preview: this.preview ? { ...this.preview } : null,
            held: this.held ? { ...this.held } : null,
            groups: Object.fromEntries(this.groups)
        };
    }

    /** Pointer release is an explicit commitment. It still passes validation. */
    pointerMove(blockId: string, to: { x: number; y: number }, timestampMs = Date.now()): SpatialCommand {
        const block = this.canvas.listBlocks().find(item => item.id === blockId);
        const proposal = this.proposal('move', [blockId], {
            point: point('canvas', to.x, to.y),
            modalities: ['pointer'],
            confidence: 1,
            timestampMs,
            evidence: ['pointer-release']
        });
        if (!block) return this.refuse(proposal, 'missing-block');
        if (to.x < 0 || to.y < 0) return this.refuse(proposal, 'out-of-bounds');
        const from = this.canvas.move(blockId, to.x, to.y);
        this.remember(blockId);
        return this.commitTracked(proposal, {
            command: 'MOVE',
            subject: blockId,
            from,
            to,
            modalities: ['pointer'],
            committedAt: timestampMs
        }, () => {
            this.canvas.move(blockId, from.x, from.y);
        });
    }

    select(ids: string[]): void {
        this.selection = [...ids];
        ids.forEach(id => this.remember(id));
    }

    speak(transcript: string, timestampMs = Date.now()): SpatialCommand {
        const names = new Map(this.canvas.listBlocks().map(block => [block.id, block.name]));
        const command = this.interpretSpeech(transcript, timestampMs);
        for (const block of this.canvas.listBlocks()) names.set(block.id, block.name);
        command.summary = describeCommand(command, id => names.get(id) ?? 'that block');
        return command;
    }

    private interpretSpeech(transcript: string, timestampMs: number): SpatialCommand {
        const intent = parseSpeech(transcript, this.catalog());
        const proposalAction = intent && intent.action !== 'confirm' ? intent.action : 'select';
        const proposal = this.proposal(proposalAction, [], {
            modalities: ['speech'],
            confidence: intent ? 0.9 : 0,
            timestampMs,
            evidence: [`speech:${transcript}`]
        });
        if (!intent) return this.refuse(proposal, 'unrecognized-speech');
        if (intent.ambiguous) return this.refuse(proposal, `ambiguous-${intent.ambiguous}`);
        if (intent.action === 'confirm') {
            if (!this.preview || this.preview.lifecycle !== 'previewing') {
                return this.refuse(proposal, 'nothing-pending');
            }
            return this.confirm(timestampMs) ?? this.refuse(proposal, 'nothing-pending');
        }
        if (this.preview || this.held) this.cancel();
        if (intent.action === 'undo') {
            this.undo();
            return this.commit(proposal, { command: 'UNDO', modalities: ['speech'], committedAt: timestampMs });
        }
        if (intent.action === 'cancel') {
            this.cancel();
            return this.commit(proposal, { command: 'CANCEL', modalities: ['speech'], committedAt: timestampMs });
        }
        if (intent.action === 'open-shell' && intent.shell) {
            const opened = this.canvas.openShell(intent.shell);
            if (!opened.ok) return this.refuse(proposal, opened.reason);
            proposal.action = 'open-shell';
            proposal.create = { blockId: intent.shell.id, displayName: opened.name };
            return this.commitTracked(proposal, {
                command: 'OPEN_SHELL',
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => {
                this.canvas.openShell({
                    id: opened.previousShellId,
                    name: 'previous',
                    kind: opened.previousShellId === 'root' ? 'root' : 'saved',
                    aliases: []
                });
            });
        }
        return this.applyIntent(intent, proposal, timestampMs);
    }

    observeHand(frame: HandObservationFrame, timestampMs = Date.now()): SpatialCommand | null {
        if (frame.trackingConfidence <= 0 || frame.landmarks.length === 0) {
            const machine = this.pinches.get(frame.handId);
            if (machine && (machine.phase === 'active' || machine.phase === 'candidate')) {
                this.pinches.set(frame.handId, stepPinch(machine, {
                    distance: null,
                    at: timestampMs,
                    anchor: { x: 0, y: 0 },
                    tracking: false
                }));
                this.cancel();
                return this.refuse(this.proposal('move', [], {
                    modalities: ['camera_hand'],
                    confidence: 0,
                    timestampMs,
                    evidence: ['tracking-lost']
                }), 'tracking-lost');
            }
            return null;
        }

        const index = frame.landmarks.find(joint => joint.joint === 'index_tip' || joint.joint === '8');
        if (!index) return null;
        const canvasPoint = cameraNormalizedToCanvas(
            point('camera_normalized', index.x, index.y, index.z),
            this.viewport
        );
        this.points.push({ at: canvasPoint, timestampMs, modality: 'camera_hand' });
        this.points = this.points.filter(item => timestampMs - item.timestampMs < 4000);

        const distance = pinchSpan(frame.landmarks);
        const previous = this.pinches.get(frame.handId) ?? initialPinch(frame.handId);
        const next = stepPinch(previous, {
            distance,
            at: timestampMs,
            anchor: { x: canvasPoint.x, y: canvasPoint.y, z: canvasPoint.z },
            tracking: true
        });
        this.pinches.set(frame.handId, next);

        if (next.phase === 'active' && previous.phase !== 'active') {
            const resolved = resolveReferents({
                shellId: this.canvas.activeShell(),
                blocks: this.canvas.listBlocks(),
                point: next.anchor ? point('canvas', next.anchor.x, next.anchor.y) : canvasPoint,
                selection: [],
                recentInteraction: this.recentInteraction,
                recentDiscourse: this.recentDiscourse
            });
            if (resolved.status !== 'resolved') {
                this.held = this.stage(this.proposal('move', [], {
                    modalities: ['camera_hand'],
                    confidence: frame.trackingConfidence,
                    timestampMs,
                    evidence: [`hand:${frame.handId}`]
                }), 'held', 'ambiguous');
                return this.held;
            }
            const subject = resolved.ids[0];
            const block = this.canvas.listBlocks().find(item => item.id === subject);
            this.activeMove = { subject, origin: { x: block?.x ?? 0, y: block?.y ?? 0 } };
            const proposal = this.proposal('move', [subject], {
                point: canvasPoint,
                modalities: ['camera_hand'],
                confidence: frame.trackingConfidence,
                timestampMs,
                evidence: [`hand:${frame.handId}`, 'pinch-active']
            });
            this.preview = this.stage(proposal, 'previewing');
            return this.preview;
        }

        if (next.phase === 'active' && this.activeMove) {
            this.canvas.move(this.activeMove.subject, canvasPoint.x, canvasPoint.y);
            if (this.preview) {
                this.preview = {
                    ...this.preview,
                    geometry: { point: canvasPoint },
                    lifecycle: 'previewing'
                };
            }
            return this.preview;
        }

        if (next.phase === 'end' && this.activeMove) {
            const subject = this.activeMove.subject;
            const origin = this.activeMove.origin;
            const to = { x: canvasPoint.x, y: canvasPoint.y };
            this.activeMove = null;
            const proposal = this.proposal('move', [subject], {
                point: canvasPoint,
                modalities: ['camera_hand'],
                confidence: frame.trackingConfidence,
                timestampMs,
                evidence: [`hand:${frame.handId}`, 'pinch-end']
            });
            this.preview = null;
            this.remember(subject);
            return this.commitTracked(proposal, {
                command: 'MOVE',
                subject,
                from: origin,
                to,
                modalities: ['camera_hand'],
                committedAt: timestampMs
            }, () => {
                this.canvas.move(subject, origin.x, origin.y);
            });
        }

        if (next.phase === 'cancel') {
            this.cancel();
        }
        return this.preview;
    }

    confirm(timestampMs = Date.now()): SpatialCommand | null {
        const pending = this.preview ?? this.held;
        if (!pending) return null;
        if (pending.lifecycle !== 'previewing') return pending;
        const proposal: MultimodalInteractionProposal = {
            id: pending.proposalId,
            action: pending.action,
            subjects: pending.subjects.map(id => ({ id })),
            target: pending.target ? { id: pending.target } : undefined,
            create: pending.create,
            geometry: pending.geometry,
            evidence: pending.evidence,
            confidence: pending.confidence,
            timestampMs
        };
        return this.execute(proposal, timestampMs, true);
    }

    cancel(): void {
        if (this.activeMove) {
            this.canvas.move(this.activeMove.subject, this.activeMove.origin.x, this.activeMove.origin.y);
            this.activeMove = null;
        }
        if (this.preview) {
            this.preview = { ...this.preview, lifecycle: 'cancelled' };
            this.commands.push(this.preview);
            this.preview = null;
        }
        if (this.held) {
            this.held = { ...this.held, lifecycle: 'cancelled' };
            this.commands.push(this.held);
            this.held = null;
        }
    }

    undo(): boolean {
        const entry = this.undoStack.pop();
        if (!entry) return false;
        entry.apply();
        const command = this.commands.find(item => item.id === entry.commandId);
        if (command) command.lifecycle = 'undone';
        return true;
    }

    private applyIntent(intent: SpeechIntent, proposal: MultimodalInteractionProposal, timestampMs: number): SpatialCommand {
        const pointHit = this.latestPoint(timestampMs);
        const resolved = resolveReferents({
            shellId: this.canvas.activeShell(),
            blocks: this.canvas.listBlocks(),
            point: intent.deixis === 'here' || intent.deixis === 'this' ? pointHit : undefined,
            selection: this.selection,
            recentInteraction: this.recentInteraction,
            recentDiscourse: this.recentDiscourse,
            noun: intent.targetName,
            allowSet: intent.deixis === 'these'
        });

        if (intent.action === 'delete' && intent.targetName && intent.deixis === 'none') {
            const named = resolveReferents({
                shellId: this.canvas.activeShell(),
                blocks: this.canvas.listBlocks(),
                selection: [],
                recentInteraction: [],
                recentDiscourse: [],
                noun: intent.targetName
            });
            if (named.status !== 'resolved') return this.hold(proposal, named.reason);
            proposal.subjects = [{ id: named.ids[0] }];
            proposal.action = 'delete';
            return this.previewDestructive(proposal);
        }

        if (intent.action === 'connect' && intent.sourceName) {
            const source = resolveReferents({
                shellId: this.canvas.activeShell(),
                blocks: this.canvas.listBlocks(),
                selection: [],
                recentInteraction: [],
                recentDiscourse: [],
                noun: intent.sourceName
            });
            const target = resolveReferents({
                shellId: this.canvas.activeShell(),
                blocks: this.canvas.listBlocks(),
                selection: [],
                recentInteraction: [],
                recentDiscourse: [],
                noun: intent.targetName
            });
            if (source.status !== 'resolved') return this.hold(proposal, source.reason);
            if (target.status !== 'resolved') return this.hold(proposal, 'ambiguous-target');
            proposal.subjects = [{ id: source.ids[0] }];
            proposal.target = { id: target.ids[0] };
            proposal.action = 'connect';
            return this.execute(proposal, timestampMs, false);
        }

        if (intent.action === 'create') {
            const at = intent.deixis === 'here' ? pointHit : point('canvas', 160, 160);
            if (intent.deixis === 'here' && !pointHit) {
                return this.hold(proposal, 'missing-point');
            }
            proposal.create = {
                blockId: intent.personaBlockId || 'text_note',
                displayName: intent.displayName || 'Note'
            };
            proposal.geometry = { point: at };
            proposal.subjects = [];
            if (intent.destructive) return this.previewDestructive(proposal);
            return this.execute(proposal, timestampMs, false);
        }

        if (resolved.status === 'hold') {
            return this.hold({ ...proposal, subjects: resolved.candidates.map(id => ({ id })) }, resolved.reason);
        }

        proposal.subjects = resolved.ids.map(id => ({ id }));
        if (intent.action === 'move') {
            if (!pointHit) return this.hold(proposal, 'missing-point');
            proposal.geometry = { point: pointHit };
        }
        if (intent.targetName && intent.action === 'connect') {
            const target = resolveReferents({
                shellId: this.canvas.activeShell(),
                blocks: this.canvas.listBlocks(),
                selection: [],
                recentInteraction: [],
                recentDiscourse: [],
                noun: intent.targetName
            });
            if (target.status !== 'resolved') return this.hold(proposal, 'ambiguous-target');
            proposal.target = { id: target.ids[0] };
        }
        if (intent.action === 'connect' && intent.deixis === 'these' && resolved.ids.length >= 2 && !proposal.target) {
            proposal.subjects = [{ id: resolved.ids[0] }];
            proposal.target = { id: resolved.ids[1] };
        }
        if (intent.destructive) return this.previewDestructive(proposal);
        return this.execute(proposal, timestampMs, false);
    }

    private execute(proposal: MultimodalInteractionProposal, timestampMs: number, fromConfirm: boolean): SpatialCommand {
        if (proposal.action === 'create' && proposal.create && proposal.geometry?.point) {
            const at = proposal.geometry.point;
            const id = this.canvas.add(proposal.create.blockId, proposal.create.displayName, at.x, at.y);
            this.remember(id);
            return this.commitTracked(proposal, {
                command: 'CREATE',
                subject: id,
                to: { x: at.x, y: at.y },
                modalities: fromConfirm ? ['speech', 'pointer'] : ['speech'],
                committedAt: timestampMs
            }, () => this.canvas.remove(id));
        }

        if (proposal.action === 'move' && proposal.subjects[0] && proposal.geometry?.point) {
            const id = proposal.subjects[0].id;
            const to = proposal.geometry.point;
            const from = this.canvas.move(id, to.x, to.y);
            this.remember(id);
            return this.commitTracked(proposal, {
                command: 'MOVE',
                subject: id,
                from,
                to: { x: to.x, y: to.y },
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => this.canvas.move(id, from.x, from.y));
        }

        if (proposal.action === 'connect' && proposal.subjects[0] && proposal.target) {
            const sourceId = proposal.subjects[0].id;
            const targetId = proposal.target.id;
            if (isSeparated(sourceId, targetId)) return this.refuse(proposal, 'kept-separate');
            const source = this.canvas.getInstance(sourceId);
            const target = this.canvas.getInstance(targetId);
            const admission = evaluateWireAdmission(source, target);
            if (!admission.ok) return this.refuse(proposal, admission.reason);
            const connected = this.canvas.connect(sourceId, targetId);
            if (!connected.ok) return this.refuse(proposal, connected.reason);
            const wireId = connected.wireId;
            return this.commitTracked(proposal, {
                command: 'CONNECT',
                subject: sourceId,
                target: targetId,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => this.canvas.disconnect(wireId));
        }

        if (proposal.action === 'delete' && proposal.subjects[0]) {
            const id = proposal.subjects[0].id;
            const removed = this.canvas.remove(id);
            return this.commitTracked(proposal, {
                command: 'DELETE',
                subject: id,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => {
                if (removed) this.canvas.restore(removed);
            });
        }

        if (proposal.action === 'group') {
            const ids = proposal.subjects.map(subject => subject.id);
            const groupId = nextId('group');
            this.groups.set(groupId, ids);
            this.canvas.setGroup(ids, groupId);
            return this.commitTracked(proposal, {
                command: 'GROUP',
                subjects: ids,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => {
                this.groups.delete(groupId);
                this.canvas.setGroup(ids, null);
            });
        }

        if (proposal.action === 'separate' && proposal.subjects.length >= 2) {
            const ids = proposal.subjects.map(subject => subject.id);
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) markSeparated(ids[i], ids[j]);
            }
            return this.commitTracked(proposal, {
                command: 'SEPARATE',
                subjects: ids,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => {
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) clearSeparated(ids[i], ids[j]);
                }
            });
        }

        if (proposal.action === 'compare') {
            const ids = proposal.subjects.map(subject => subject.id);
            const noteId = this.canvas.add('text_note', 'Compare', 80, 80);
            return this.commitTracked(proposal, {
                command: 'COMPARE',
                subjects: ids,
                subject: noteId,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => this.canvas.remove(noteId));
        }

        if (proposal.action === 'branch' && proposal.subjects[0]) {
            const id = proposal.subjects[0].id;
            const block = this.canvas.listBlocks().find(item => item.id === id);
            const copyId = this.canvas.add(block?.blockId ?? 'text_note', `${block?.name ?? 'Branch'} copy`, (block?.x ?? 0) + 48, (block?.y ?? 0) + 48);
            return this.commitTracked(proposal, {
                command: 'BRANCH',
                subject: id,
                target: copyId,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => this.canvas.remove(copyId));
        }

        if (proposal.action === 'crystallize' && proposal.subjects[0]) {
            const id = proposal.subjects[0].id;
            const noteId = this.canvas.add('memory_pool', 'Memory', 200, 80);
            const connected = this.canvas.connect(noteId, id);
            return this.commitTracked(proposal, {
                command: 'CRYSTALLIZE',
                subject: id,
                target: noteId,
                modalities: ['speech'],
                committedAt: timestampMs
            }, () => {
                if (connected.ok) this.canvas.disconnect(connected.wireId);
                this.canvas.remove(noteId);
            });
        }

        return this.refuse(proposal, 'unsupported');
    }

    private previewDestructive(proposal: MultimodalInteractionProposal): SpatialCommand {
        this.preview = this.stage(proposal, 'previewing', 'destructive-needs-confirm');
        return this.preview;
    }

    private proposal(
        action: MultimodalInteractionProposal['action'],
        subjects: string[],
        extra: {
            point?: FramedPoint;
            modalities: InputModality[];
            confidence: number;
            timestampMs: number;
            evidence: string[];
        }
    ): MultimodalInteractionProposal {
        return {
            id: nextId('proposal'),
            action,
            subjects: subjects.map(id => ({ id })),
            geometry: extra.point ? { point: extra.point } : undefined,
            evidence: extra.evidence,
            confidence: extra.confidence,
            timestampMs: extra.timestampMs
        };
    }

    private stage(proposal: MultimodalInteractionProposal, lifecycle: CommandLifecycle, reason?: string): SpatialCommand {
        return {
            id: nextId('cmd'),
            proposalId: proposal.id,
            action: proposal.action,
            subjects: proposal.subjects.map(subject => subject.id),
            target: proposal.target?.id,
            create: proposal.create,
            geometry: proposal.geometry,
            evidence: proposal.evidence,
            modalities: proposal.evidence.some(item => item.startsWith('speech')) ? ['speech'] : ['camera_hand'],
            confidence: proposal.confidence,
            lifecycle,
            reason,
            shellId: this.canvas.activeShell(),
            timestampMs: proposal.timestampMs
        };
    }

    private commit(proposal: MultimodalInteractionProposal, trace: InteractionTrace): SpatialCommand {
        const command = this.stage(proposal, 'committed');
        command.modalities = trace.modalities;
        this.commands.push(command);
        this.traces.push(trace);
        this.preview = null;
        this.held = null;
        return command;
    }

    private commitTracked(
        proposal: MultimodalInteractionProposal,
        trace: InteractionTrace,
        apply: () => void
    ): SpatialCommand {
        const command = this.commit(proposal, trace);
        this.undoStack.push({ commandId: command.id, apply });
        return command;
    }

    private refuse(proposal: MultimodalInteractionProposal, reason: string): SpatialCommand {
        const command = this.stage(proposal, 'refused', reason);
        this.commands.push(command);
        return command;
    }

    private hold(proposal: MultimodalInteractionProposal, reason: string): SpatialCommand {
        const command = this.stage(proposal, 'held', reason);
        this.held = command;
        this.commands.push(command);
        return command;
    }

    private latestPoint(now: number): FramedPoint | undefined {
        const recent = [...this.points].reverse().find(item => {
            const age = now - item.timestampMs;
            return item.modality === 'pointer' ? age <= 60_000 : age <= 2500;
        });
        return recent?.at;
    }

    private remember(id: string): void {
        this.recentInteraction = [id, ...this.recentInteraction.filter(item => item !== id)].slice(0, 8);
        this.recentDiscourse = this.recentInteraction;
    }

    notePoint(at: FramedPoint, timestampMs: number, modality: InputModality = 'pointer'): void {
        if (at.frame !== 'canvas') throw new Error(`Points recorded for fusion must be canvas coordinates, received ${at.frame}`);
        this.points.push({ at, timestampMs, modality });
    }
}
