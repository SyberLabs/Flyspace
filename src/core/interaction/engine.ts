// One commit boundary for pointer and speech.
// Adapters never call the canvas stores.

import type { BlockInstance } from '@/core/schemas/block.schema';
import type { ContextEntry } from '@/core/schemas/mind.schema';
import type { DataWire } from '@/core/schemas/wire.schema';
import { evaluateWireAdmission } from './ports';
import { defaultSpeechCatalog, parseSpeech, type SpeechCatalog, type SpeechIntent, type SpeechShellKind } from './speech';
import { describeCommand } from './speechReply';
import { resolveReferents, type ResolveResult } from './referent';
import { point } from './coordinates';
import { isSpeechObservationV1, type SpeechObservationV1 } from './speechObservation';
import { compileDeterministic, outOfScopeReason, type IntentCompilerResult, type IntentContext } from './intentCompiler';
import { validateProposal, type SpatialCommandProposalV1 } from './proposal';
import type {
    CanvasBlockView,
    CommandLifecycle,
    FramedPoint,
    InputModality,
    InteractionTrace,
    MultimodalInteractionProposal,
    SpatialCommand,
    SpeechEvidence
} from './types';

/** What a delete took off the canvas. Undo hands it back whole. */
export interface RemovedBlock {
    block: BlockInstance;
    wires: DataWire[];
}

export interface CanvasMutator {
    listBlocks(): CanvasBlockView[];
    getInstance(id: string): BlockInstance | undefined;
    activeShell(): string;
    move(id: string, x: number, y: number): { x: number; y: number };
    add(blockId: string, displayName: string, x: number, y: number): string;
    remove(id: string): RemovedBlock | undefined;
    /** Re-admits the wires; a wire the canvas would refuse now stays gone. */
    restore(removed: RemovedBlock): void;
    connect(sourceId: string, targetId: string): { ok: true; wireId: string } | { ok: false; reason: string };
    disconnect(wireId: string): void;
    /** Admit one entry into a Mind pool; returns the entry id so undo can remove it. */
    keep(poolId: string, entry: KeptEntry): string;
    unkeep(poolId: string, entryId: string): void;
    openShell(target: SpeechShellKind): { ok: true; name: string; previousShellId: string } | { ok: false; reason: string };
}

export type KeptEntry = Omit<ContextEntry, 'id' | 'timestamp'>;

interface UndoEntry {
    commandId: string;
    apply: () => void;
}

export interface EngineSnapshot {
    commands: SpatialCommand[];
    traces: InteractionTrace[];
    preview: SpatialCommand | null;
    held: SpatialCommand | null;
}

let sequence = 0;
function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}_${sequence}`;
}

const CONSUMED_SESSION_LIMIT = 512;
const CONTEXT_BLOCK_LIMIT = 100;

/** A grammar intent, or one mapped from a proposal whose candidate ids the engine already checked. */
type EngineIntent = SpeechIntent & { subjectIds?: string[]; targetId?: string };

function speechEvidence(observation: SpeechObservationV1): SpeechEvidence {
    const evidence: SpeechEvidence = {
        observationId: observation.observationId,
        sessionId: observation.sessionId,
        adapterId: observation.provider.adapterId,
        startedAtMs: observation.startedAtMs,
        receivedAtMs: observation.receivedAtMs
    };
    if (observation.provider.providerName) evidence.providerName = observation.provider.providerName;
    if (observation.provider.model) evidence.model = observation.provider.model;
    if (observation.locale) evidence.locale = observation.locale;
    if (observation.endedAtMs !== undefined) evidence.endedAtMs = observation.endedAtMs;
    if (observation.confidence !== undefined) evidence.confidence = observation.confidence;
    return evidence;
}

function sameResult(a: IntentCompilerResult, b: IntentCompilerResult): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function provenanceEvidence(speech: SpeechEvidence): string[] {
    return [
        `speech-observation:${speech.observationId}`,
        `speech-session:${speech.sessionId}`,
        `speech-provider:${speech.adapterId}`
    ];
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
    private points: Array<{ at: FramedPoint; timestampMs: number }> = [];
    private consumedSpeechSessions: string[] = [];
    private speechContext: SpeechEvidence | null = null;

    constructor(
        private readonly canvas: CanvasMutator,
        private readonly catalog: () => SpeechCatalog = defaultSpeechCatalog
    ) {}

    snapshot(): EngineSnapshot {
        return {
            commands: this.commands.map(command => ({
                ...command,
                subjects: [...command.subjects],
                evidence: [...command.evidence],
                modalities: [...command.modalities],
                summary: command.summary,
                ...(command.speech ? { speech: { ...command.speech } } : {})
            })),
            traces: this.traces.map(trace => ({ ...trace })),
            preview: this.preview ? { ...this.preview } : null,
            held: this.held ? { ...this.held } : null
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

    /**
     * A click keeps text (a Think reply) in a Mind pool. Pools are persisted
     * canvas memory a Memory block can wire into a persona prompt, so model
     * output reaches one only through this commit boundary, with an undo.
     */
    keep(poolId: string, entry: KeptEntry, timestampMs = Date.now()): SpatialCommand {
        const proposal = this.proposal('keep', [], {
            modalities: ['pointer'],
            confidence: 1,
            timestampMs,
            evidence: ['pointer-click:keep', `pool:${poolId}`]
        });
        proposal.target = { id: poolId };
        if (!entry.content.trim()) return this.refuse(proposal, 'empty-content');
        const entryId = this.canvas.keep(poolId, entry);
        proposal.subjects = [{ id: entryId }];
        return this.commitTracked(proposal, {
            command: 'KEEP',
            subject: entryId,
            target: poolId,
            modalities: ['pointer'],
            committedAt: timestampMs
        }, () => this.canvas.unkeep(poolId, entryId));
    }

    /**
     * A click places a block on the canvas: today, an API installed from the
     * Add an API dialog. Admitted, traced and undoable exactly like a spoken
     * "add", so a UI add is not one more direct canvas writer (AGENTS.md
     * "adapters never call the canvas stores directly"; MasterMind critique
     * O8). An unknown block type is refused, not thrown at the caller.
     */
    place(blockId: string, displayName: string, at: { x: number; y: number }, timestampMs = Date.now()): SpatialCommand {
        const point: FramedPoint = { frame: 'canvas', x: at.x, y: at.y };
        const proposal = this.proposal('create', [], {
            point,
            modalities: ['pointer'],
            confidence: 1,
            timestampMs,
            evidence: ['pointer-click:place', `block:${blockId}`]
        });
        proposal.create = { blockId, displayName };
        if (!blockId.trim() || !displayName.trim()) return this.refuse(proposal, 'empty-block');

        let id: string;
        try {
            id = this.canvas.add(blockId, displayName, at.x, at.y);
        } catch {
            return this.refuse(proposal, 'unknown-block');
        }
        this.remember(id);
        proposal.subjects = [{ id }];
        return this.commitTracked(proposal, {
            command: 'CREATE',
            subject: id,
            to: this.placedAt(id, at),
            modalities: ['pointer'],
            committedAt: timestampMs
        }, () => this.canvas.remove(id));
    }

    select(ids: string[]): void {
        this.selection = [...ids];
        ids.forEach(id => this.remember(id));
    }

    /** Scripted transcript with no capture provenance. Tests and the harness use it. */
    speak(transcript: string, timestampMs = Date.now()): SpatialCommand {
        return this.described(() => this.interpretSpeech(transcript, timestampMs));
    }

    /**
     * The speech commit path. Only a valid final observation is interpreted,
     * and each speech session yields at most one interpretation.
     */
    hear(observation: SpeechObservationV1, timestampMs = Date.now()): SpatialCommand {
        const context = this.describeSpeechContext();
        const result = isSpeechObservationV1(observation)
            ? compileDeterministic(observation, context) ?? { kind: 'refuse' as const, reason: 'unrecognized-speech', via: 'grammar' as const }
            : { kind: 'refuse' as const, reason: 'invalid-observation', via: 'grammar' as const };
        return this.admitSpeech(observation, result, timestampMs);
    }

    /** Bounded descriptors for a compiler: active shell only, no store handles. */
    describeSpeechContext(): IntentContext {
        const shellId = this.canvas.activeShell();
        const visible = this.canvas.listBlocks().filter(block => block.shellId === shellId).slice(0, CONTEXT_BLOCK_LIMIT);
        const ids = new Set(visible.map(block => block.id));
        return {
            activeShellId: shellId,
            vocabulary: this.catalog(),
            visibleBlocks: visible.map(block => ({ id: block.id, name: block.name, blockId: block.blockId, tags: [...block.tags] })),
            selection: this.selection.filter(id => ids.has(id))
        };
    }

    /**
     * Second gate for anything a compiler produced. The observation is checked,
     * the proposal is re-validated, reserved operations are re-derived from the
     * fixed grammar, and referents are resolved against the live canvas.
     */
    admitSpeech(observation: SpeechObservationV1, result: IntentCompilerResult, timestampMs = Date.now()): SpatialCommand {
        const gate = this.admitObservation(observation, timestampMs);
        if (gate) return gate;
        return this.withSpeech(observation, () => this.described(() => this.admitResult(observation, result, timestampMs)));
    }

    private admitResult(observation: SpeechObservationV1, result: IntentCompilerResult, timestampMs: number): SpatialCommand {
        const transcript = observation.transcript;
        const evidence = [...this.transcriptEvidence(transcript), `speech-compiler:${result.via}`];
        const bare = () => this.proposal('select', [], { modalities: ['speech'], confidence: 0, timestampMs, evidence });
        if (result.kind === 'refuse') return this.refuse(bare(), result.reason);
        const catalog = this.catalog();
        if (result.via === 'grammar') {
            // A grammar label is a claim. The engine re-derives it and interprets its own parse.
            const host = compileDeterministic(observation, this.describeSpeechContext());
            const intent = parseSpeech(transcript, catalog);
            if (!host || host.kind === 'refuse' || !intent || !sameResult(host, result)) return this.refuse(bare(), 'grammar-mismatch');
            return this.interpretIntent(intent, timestampMs, evidence);
        }
        if (result.kind === 'needs-input') {
            if (this.preview || this.held) this.cancel();
            return this.hold(bare(), result.reason);
        }
        const checked = validateProposal(result.proposal, {
            observationId: observation.observationId,
            vocabulary: catalog,
            allowReserved: false
        });
        if (!checked.ok) return this.refuse(bare(), `invalid-proposal:${checked.reason}`);
        const proposal = checked.proposal;
        if (proposal.operation === 'RESOLVE_CAPABILITY') return this.refuse(bare(), 'capability-bridge-unavailable');
        const mapped = this.proposalIntent(proposal, catalog);
        if ('hold' in mapped) {
            if (this.preview || this.held) this.cancel();
            return this.hold(bare(), mapped.hold);
        }
        return this.interpretIntent(mapped.intent, timestampMs, evidence);
    }

    private proposalIntent(proposal: SpatialCommandProposalV1, catalog: SpeechCatalog): { intent: EngineIntent } | { hold: string } {
        const shellId = this.canvas.activeShell();
        const live = new Set(this.canvas.listBlocks().filter(block => block.shellId === shellId).map(block => block.id));
        const intent: EngineIntent = { action: 'select', deixis: 'none', destructive: false };
        const subject = proposal.subject;
        const target = proposal.target;
        if (subject?.kind === 'candidate') {
            if (!live.has(subject.id)) return { hold: 'stale-referent' };
            intent.subjectIds = [subject.id];
        } else if (subject?.kind === 'deictic') {
            intent.deixis = subject.word;
        }
        if (target?.kind === 'candidate') {
            if (!live.has(target.id)) return { hold: 'stale-referent' };
            intent.targetId = target.id;
        } else if (target?.kind === 'named') {
            intent.targetName = target.name;
        }
        switch (proposal.operation) {
            case 'CREATE': {
                const kind = subject?.kind === 'block-type' ? catalog.blocks.find(block => block.blockId === subject.blockId) : undefined;
                if (!kind) return { hold: 'unknown-block-type' };
                return { intent: {
                    action: 'create',
                    personaBlockId: kind.blockId,
                    displayName: kind.displayName,
                    deixis: proposal.placement?.kind === 'pointed' ? 'here' : 'none',
                    destructive: false
                } };
            }
            case 'MOVE':
                intent.action = 'move';
                intent.deixis = 'here';
                if (subject?.kind === 'named') intent.targetName = subject.name;
                return { intent };
            case 'CONNECT':
                intent.action = 'connect';
                if (subject?.kind === 'named') intent.sourceName = subject.name;
                return { intent };
            case 'DELETE':
                intent.action = 'delete';
                intent.destructive = true;
                if (subject?.kind === 'named') intent.targetName = subject.name;
                return { intent };
            case 'OPEN_SHELL': {
                const shell = target?.kind === 'shell' ? catalog.shells.find(item => item.id === target.shellId) : undefined;
                if (!shell) return { hold: 'missing-shell' };
                return { intent: { action: 'open-shell', shell, deixis: 'none', destructive: false } };
            }
            case 'BRANCH':
                intent.action = 'branch';
                return { intent };
            case 'CRYSTALLIZE':
                intent.action = 'crystallize';
                return { intent };
            case 'UNDO':
                return { intent: { action: 'undo', deixis: 'none', destructive: false } };
            case 'CANCEL':
                return { intent: { action: 'cancel', deixis: 'none', destructive: false } };
            case 'CONFIRM':
                return { intent: { action: 'confirm', deixis: 'none', destructive: false } };
            default:
                return { hold: 'unsupported' };
        }
    }

    private admitObservation(observation: SpeechObservationV1, timestampMs: number): SpatialCommand | null {
        if (!isSpeechObservationV1(observation)) {
            const proposal = this.proposal('select', [], {
                modalities: ['speech'], confidence: 0, timestampMs, evidence: ['speech-observation:invalid']
            });
            return this.described(() => this.refuse(proposal, 'invalid-observation'));
        }
        const refuseWith = (reason: string) => this.withSpeech(observation, () => {
            const proposal = this.proposal('select', [], {
                modalities: ['speech'], confidence: 0, timestampMs, evidence: this.transcriptEvidence(observation.transcript)
            });
            return this.described(() => this.refuse(proposal, reason));
        });
        if (!observation.final) return refuseWith('not-final');
        if (this.consumedSpeechSessions.includes(observation.sessionId)) return refuseWith('duplicate-final');
        this.consumedSpeechSessions = [observation.sessionId, ...this.consumedSpeechSessions].slice(0, CONSUMED_SESSION_LIMIT);
        return null;
    }

    private withSpeech<T>(observation: SpeechObservationV1, run: () => T): T {
        const previous = this.speechContext;
        this.speechContext = speechEvidence(observation);
        try {
            return run();
        } finally {
            this.speechContext = previous;
        }
    }

    private transcriptEvidence(transcript: string): string[] {
        return [`speech:${transcript}`, ...(this.speechContext ? provenanceEvidence(this.speechContext) : [])];
    }

    private described(run: () => SpatialCommand): SpatialCommand {
        const names = new Map(this.canvas.listBlocks().map(block => [block.id, block.name]));
        const command = run();
        for (const block of this.canvas.listBlocks()) names.set(block.id, block.name);
        command.summary = describeCommand(command, id => names.get(id) ?? 'that block');
        return command;
    }

    private interpretSpeech(transcript: string, timestampMs: number): SpatialCommand {
        const evidence = this.transcriptEvidence(transcript);
        const scope = outOfScopeReason(transcript);
        if (scope) {
            return this.refuse(this.proposal('select', [], { modalities: ['speech'], confidence: 0, timestampMs, evidence }), scope);
        }
        return this.interpretIntent(parseSpeech(transcript, this.catalog()), timestampMs, evidence);
    }

    private interpretIntent(intent: EngineIntent | null, timestampMs: number, evidence: string[]): SpatialCommand {
        const proposalAction = intent && intent.action !== 'confirm' ? intent.action : 'select';
        const proposal = this.proposal(proposalAction, [], {
            modalities: ['speech'],
            confidence: intent ? 0.9 : 0,
            timestampMs,
            evidence
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
            evidence: this.speechContext
                ? [...new Set([...pending.evidence, ...provenanceEvidence(this.speechContext)])]
                : pending.evidence,
            confidence: pending.confidence,
            timestampMs
        };
        return this.execute(proposal, timestampMs, true);
    }

    cancel(): void {
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

    private applyIntent(intent: EngineIntent, proposal: MultimodalInteractionProposal, timestampMs: number): SpatialCommand {
        const pointHit = this.latestPoint(timestampMs);
        const resolved = intent.subjectIds
            ? { status: 'resolved' as const, ids: intent.subjectIds }
            : resolveReferents({
                shellId: this.canvas.activeShell(),
                blocks: this.canvas.listBlocks(),
                point: intent.deixis === 'here' || intent.deixis === 'this' ? pointHit : undefined,
                selection: this.selection,
                recentInteraction: this.recentInteraction,
                recentDiscourse: this.recentDiscourse,
                noun: intent.targetName,
                allowSet: intent.deixis === 'these'
            });

        if (intent.action === 'delete' && intent.subjectIds) {
            proposal.subjects = intent.subjectIds.map(id => ({ id }));
            proposal.action = 'delete';
            return this.previewDestructive(proposal);
        }

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
            const target = this.connectTarget(intent);
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
        if ((intent.targetName || intent.targetId) && intent.action === 'connect') {
            const target = this.connectTarget(intent);
            if (target.status !== 'resolved') return this.hold(proposal, 'ambiguous-target');
            proposal.target = { id: target.ids[0] };
        }
        if (intent.destructive) return this.previewDestructive(proposal);
        return this.execute(proposal, timestampMs, false);
    }

    /** Where a created block actually landed: the canvas moves it off occupied space. */
    private placedAt(id: string, requested: { x: number; y: number }): { x: number; y: number } {
        const placed = this.canvas.getInstance(id)?.position;
        return placed ? { x: placed.x, y: placed.y } : { x: requested.x, y: requested.y };
    }

    private connectTarget(intent: EngineIntent): ResolveResult {
        if (intent.targetId) return { status: 'resolved', ids: [intent.targetId] };
        return resolveReferents({
            shellId: this.canvas.activeShell(),
            blocks: this.canvas.listBlocks(),
            selection: [],
            recentInteraction: [],
            recentDiscourse: [],
            noun: intent.targetName
        });
    }

    private execute(proposal: MultimodalInteractionProposal, timestampMs: number, fromConfirm: boolean): SpatialCommand {
        if (proposal.action === 'create' && proposal.create && proposal.geometry?.point) {
            const at = proposal.geometry.point;
            const id = this.canvas.add(proposal.create.blockId, proposal.create.displayName, at.x, at.y);
            this.remember(id);
            return this.commitTracked(proposal, {
                command: 'CREATE',
                subject: id,
                to: this.placedAt(id, at),
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
            modalities: proposal.evidence.some(item => item.startsWith('speech')) ? ['speech'] : ['pointer'],
            confidence: proposal.confidence,
            lifecycle,
            reason,
            shellId: this.canvas.activeShell(),
            timestampMs: proposal.timestampMs,
            ...(this.speechContext ? { speech: { ...this.speechContext } } : {})
        };
    }

    private commit(proposal: MultimodalInteractionProposal, trace: InteractionTrace): SpatialCommand {
        const command = this.stage(proposal, 'committed');
        command.modalities = trace.modalities;
        this.commands.push(command);
        this.traces.push(this.speechContext
            ? {
                ...trace,
                speechObservationId: this.speechContext.observationId,
                speechSessionId: this.speechContext.sessionId,
                speechAdapterId: this.speechContext.adapterId
            }
            : trace);
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
        return [...this.points].reverse().find(item => now - item.timestampMs <= 60_000)?.at;
    }

    private remember(id: string): void {
        this.recentInteraction = [id, ...this.recentInteraction.filter(item => item !== id)].slice(0, 8);
        this.recentDiscourse = this.recentInteraction;
    }

    notePoint(at: FramedPoint, timestampMs: number): void {
        this.points.push({ at, timestampMs });
    }
}
