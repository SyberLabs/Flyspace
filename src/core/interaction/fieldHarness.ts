// Field evaluation harness (spec §18, WP-OMNI-SPEECH-04). Scripted tasks run
// against the in-memory engine: speech through push-to-talk → compiler → engine,
// pointer/keyboard through the engine's pointer functions. It counts completion,
// errors, clarifications and confirmations. It measures no latency and records
// no preference; a preference exists only when a human supplied one.

import { point } from './coordinates';
import { InteractionEngine } from './engine';
import type { MemoryCanvas } from './memoryCanvas';
import { scriptedSpeechAdapter } from './scriptedSpeechAdapter';
import { createSpeechInput, type SpeechOutcome } from './speechInput';
import type { SpeechErrorCode } from './speechObservation';
import type { SpatialCommand } from './types';
import { buildScene, compilerFor, CORPUS_CATALOG, type CompilerConfig, type SceneId } from './utterances';

export type FieldTaskId = 'instantiate-place' | 'connect-source-persona' | 'open-shell' | 'delete-with-confirmation';

export type SpeechTurn =
    | { say: string; fail?: SpeechErrorCode; interrupt?: boolean }
    | { select: string[] }
    | { pointAt: { x: number; y: number } };

export interface SpeechVariant {
    id: string;
    config: CompilerConfig;
    scene?: SceneId;
    turns: SpeechTurn[];
}

export interface FieldTask {
    id: FieldTaskId;
    title: string;
    scene: SceneId;
    done(canvas: MemoryCanvas): boolean;
    /** The existing pointer/keyboard route for the same outcome. */
    pointer: { id: string; note: string; run(engine: InteractionEngine, canvas: MemoryCanvas): SpatialCommand | void };
    speech: SpeechVariant[];
}

export interface TurnRecord {
    turn: string;
    outcome: SpeechOutcome['kind'] | 'none' | 'pointer';
    lifecycle?: SpatialCommand['lifecycle'];
    reason?: string;
}

export interface FieldRun {
    task: FieldTaskId;
    path: 'speech' | 'pointer';
    variant: string;
    config: CompilerConfig | null;
    completed: boolean;
    speechTurns: number;
    pointerActs: number;
    errors: number;
    clarifications: number;
    confirmations: number;
    turns: TurnRecord[];
    latency: 'not measured';
}

/** Supplied by a person after a session. The harness never fills this in. */
export interface HumanPreference {
    participant: string;
    task: FieldTaskId;
    prefers: 'speech' | 'pointer' | 'no preference';
    recordedAt: string;
}

const PERSONA = (blockId: string) => blockId.startsWith('persona_');

export const FIELD_TASKS: FieldTask[] = [
    {
        id: 'instantiate-place',
        title: 'Place a Hacker News block at a chosen spot',
        scene: 'board',
        done: canvas => canvas.blocks.some(block => block.schema.block_id === 'hackernews_feed' && block.position.x === 640 && block.position.y === 360),
        pointer: {
            id: 'sidebar-drop',
            note: 'Canvas sidebar drop → pointerCreate',
            run: engine => engine.pointerCreate('hackernews_feed', { x: 640, y: 360 }, 'sidebar-drop')
        },
        speech: [
            { id: 'grammar', config: 'deterministic-only', turns: [{ pointAt: { x: 640, y: 360 } }, { say: 'add hacker news here' }] },
            { id: 'paraphrase', config: 'paraphrase', turns: [{ pointAt: { x: 640, y: 360 } }, { say: 'put hacker news over here' }] },
            {
                id: 'paraphrase-then-grammar',
                config: 'deterministic-only',
                turns: [{ pointAt: { x: 640, y: 360 } }, { say: 'put hacker news over here' }, { say: 'add hacker news here' }]
            },
            {
                id: 'no-point-then-point',
                config: 'deterministic-only',
                turns: [{ say: 'add hacker news here' }, { pointAt: { x: 640, y: 360 } }, { say: 'add hacker news here' }]
            }
        ]
    },
    {
        id: 'connect-source-persona',
        title: 'Wire Hacker News into a persona',
        scene: 'board',
        done: canvas => canvas.wires.some(wire => wire.source === 'hn' && PERSONA(canvas.getInstance(wire.target)?.schema.block_id ?? '')),
        pointer: {
            id: 'wire-handle',
            note: 'WireHandle drag → pointerConnect',
            run: engine => engine.pointerConnect('hn', 'analyst')
        },
        speech: [
            { id: 'grammar', config: 'deterministic-only', turns: [{ say: 'wire hacker news to the analyst' }] },
            { id: 'paraphrase', config: 'paraphrase', turns: [{ say: 'feed hacker news into the analyst' }] },
            { id: 'deixis', config: 'deterministic-only', turns: [{ select: ['hn'] }, { say: 'give this to the analyst' }] },
            {
                id: 'disconnect-then-retry',
                config: 'deterministic-only',
                turns: [{ say: 'wire hacker news to the analyst', fail: 'disconnected' }, { say: 'wire hacker news to the analyst' }]
            },
            {
                id: 'ambiguous-target',
                config: 'deterministic-only',
                scene: 'similar-personas',
                turns: [{ say: 'wire hacker news to the analyst' }, { say: 'wire hacker news to analyst copy' }]
            }
        ]
    },
    {
        id: 'open-shell',
        title: 'Open the Research shell',
        scene: 'board',
        done: canvas => canvas.shell === 'tpl_research',
        pointer: {
            id: 'shell-panel',
            note: 'ShellPanel handleUseTemplate → shellStore (modelled as CanvasMutator.openShell; not an engine command)',
            run: (_engine, canvas) => {
                const shell = CORPUS_CATALOG.shells.find(item => item.id === 'tpl_research');
                if (shell) canvas.openShell(shell);
            }
        },
        speech: [
            { id: 'grammar', config: 'deterministic-only', turns: [{ say: 'open research' }] },
            { id: 'paraphrase', config: 'paraphrase', turns: [{ say: 'can you open research' }] },
            { id: 'paraphrase-under-grammar', config: 'deterministic-only', turns: [{ say: 'can you open research' }] }
        ]
    },
    {
        id: 'delete-with-confirmation',
        title: 'Delete the Hacker News block',
        scene: 'board',
        done: canvas => !canvas.getInstance('hn'),
        pointer: {
            id: 'close-control',
            note: 'BlockCard close → pointerDelete (the click is the commitment; no confirm step, undoable)',
            run: engine => engine.pointerDelete('hn')
        },
        speech: [
            { id: 'grammar', config: 'deterministic-only', turns: [{ select: ['hn'] }, { say: 'delete this' }, { say: 'confirm' }] },
            { id: 'named', config: 'deterministic-only', turns: [{ say: 'delete hacker news' }, { say: 'confirm' }] },
            { id: 'paraphrase', config: 'paraphrase', turns: [{ select: ['hn'] }, { say: 'get rid of this' }, { say: 'confirm' }] },
            { id: 'filler-then-confirm', config: 'deterministic-only', turns: [{ select: ['hn'] }, { say: 'delete this' }, { say: 'yeah' }, { say: 'confirm' }] },
            {
                id: 'interrupted-then-retry',
                config: 'deterministic-only',
                turns: [{ select: ['hn'] }, { say: 'delete this', interrupt: true }, { say: 'delete this' }, { say: 'confirm' }]
            }
        ]
    }
];

async function speakTurn(engine: InteractionEngine, turn: { say: string; fail?: SpeechErrorCode; interrupt?: boolean }, config: CompilerConfig) {
    const input = createSpeechInput({
        adapter: scriptedSpeechAdapter({ final: turn.say, ...(turn.fail ? { failOnStop: turn.fail } : {}) }),
        authority: engine,
        compiler: compilerFor(config)
    });
    const failed = await input.press();
    if (failed) return failed;
    if (turn.interrupt) input.cancel();
    return input.release();
}

function tally(run: FieldRun, command: SpatialCommand | undefined, isConfirm: boolean): void {
    if (!command) return;
    if (command.lifecycle === 'refused') run.errors += 1;
    if (command.lifecycle === 'held') run.clarifications += 1;
    if (isConfirm && command.lifecycle === 'committed') run.confirmations += 1;
}

export async function runSpeechVariant(task: FieldTask, variant: SpeechVariant): Promise<FieldRun> {
    const canvas = buildScene(variant.scene ?? task.scene);
    const engine = new InteractionEngine(canvas, () => CORPUS_CATALOG);
    const run: FieldRun = {
        task: task.id, path: 'speech', variant: variant.id, config: variant.config,
        completed: false, speechTurns: 0, pointerActs: 0, errors: 0, clarifications: 0, confirmations: 0,
        turns: [], latency: 'not measured'
    };
    for (const turn of variant.turns) {
        if (task.done(canvas)) break;
        if ('select' in turn) {
            engine.select(turn.select);
            run.pointerActs += 1;
            run.turns.push({ turn: `select ${turn.select.join(',')}`, outcome: 'pointer' });
            continue;
        }
        if ('pointAt' in turn) {
            engine.notePoint(point('canvas', turn.pointAt.x, turn.pointAt.y), Date.now());
            run.pointerActs += 1;
            run.turns.push({ turn: `point ${turn.pointAt.x},${turn.pointAt.y}`, outcome: 'pointer' });
            continue;
        }
        run.speechTurns += 1;
        const outcome = await speakTurn(engine, turn, variant.config);
        const command = outcome?.kind === 'command' ? outcome.command : undefined;
        if (outcome?.kind === 'error') run.errors += 1;
        tally(run, command, turn.say === 'confirm');
        run.turns.push({ turn: turn.say, outcome: outcome?.kind ?? 'none', lifecycle: command?.lifecycle, reason: command?.reason ?? (outcome?.kind === 'error' ? outcome.code : undefined) });
    }
    run.completed = task.done(canvas);
    return run;
}

export function runPointerTask(task: FieldTask): FieldRun {
    const canvas = buildScene(task.scene);
    const engine = new InteractionEngine(canvas, () => CORPUS_CATALOG);
    const command = task.pointer.run(engine, canvas) ?? undefined;
    const run: FieldRun = {
        task: task.id, path: 'pointer', variant: task.pointer.id, config: null,
        completed: task.done(canvas), speechTurns: 0, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0,
        turns: [{ turn: task.pointer.note, outcome: 'pointer', lifecycle: command?.lifecycle, reason: command?.reason }],
        latency: 'not measured'
    };
    tally(run, command, false);
    return run;
}

export async function runFieldEvaluation(tasks: FieldTask[] = FIELD_TASKS): Promise<FieldRun[]> {
    const runs: FieldRun[] = [];
    for (const task of tasks) {
        runs.push(runPointerTask(task));
        for (const variant of task.speech) runs.push(await runSpeechVariant(task, variant));
    }
    return runs;
}

export function renderFieldTable(runs: FieldRun[]): string {
    const header = '| Task | Path | Variant | Compiler | Completed | Speech turns | Pointer acts | Errors | Clarifications | Confirmations | Latency |';
    const rule = '|---|---|---|---|---|---|---|---|---|---|---|';
    const rows = runs.map(run => `| ${[
        run.task, run.path, run.variant, run.config ?? '—', run.completed ? 'yes' : 'no',
        run.speechTurns, run.pointerActs, run.errors, run.clarifications, run.confirmations, run.latency
    ].join(' | ')} |`);
    return [header, rule, ...rows].join('\n');
}

/** Counts human-supplied preferences. With none supplied, there is nothing to report. */
export function summarizePreferences(preferences: HumanPreference[]): 'not measured' | Record<HumanPreference['prefers'], number> {
    if (preferences.length === 0) return 'not measured';
    const counts = { speech: 0, pointer: 0, 'no preference': 0 };
    for (const item of preferences) counts[item.prefers] += 1;
    return counts;
}

export const FIELD_TABLE_START = '<!-- field-table:start -->';
export const FIELD_TABLE_END = '<!-- field-table:end -->';
