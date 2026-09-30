import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InteractionEngine } from './engine';
import {
    FIELD_TASKS,
    renderFieldTable,
    runFieldEvaluation,
    summarizePreferences,
    type FieldRun,
    type FieldTaskId
} from './fieldHarness';
import { buildScene, CORPUS_CATALOG } from './utterances';

const TASKS: FieldTaskId[] = ['instantiate-place', 'connect-source-persona', 'open-shell', 'delete-with-confirmation'];

function pick(runs: FieldRun[], task: FieldTaskId, variant: string): FieldRun {
    const found = runs.find(run => run.task === task && run.variant === variant);
    expect(found, `${task}/${variant}`).toBeDefined();
    return found!;
}

describe('field evaluation harness', () => {
    it('scores the four scripted tasks for speech and pointer', async () => {
        expect(FIELD_TASKS.map(task => task.id)).toEqual(TASKS);
        const runs = await runFieldEvaluation();

        expect(runs.map(run => run.latency)).toEqual(runs.map(() => 'not measured'));
        expect(renderFieldTable(runs)).not.toMatch(/p50|p95|%|prefer/i);
        expect(summarizePreferences([])).toBe('not measured');

        const counts = (task: FieldTaskId, variant: string) => {
            const run = pick(runs, task, variant);
            return {
                completed: run.completed,
                speechTurns: run.speechTurns,
                pointerActs: run.pointerActs,
                errors: run.errors,
                clarifications: run.clarifications,
                confirmations: run.confirmations
            };
        };

        expect(counts('instantiate-place', 'sidebar-drop')).toEqual({
            completed: true, speechTurns: 0, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('instantiate-place', 'grammar')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('instantiate-place', 'paraphrase')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('instantiate-place', 'paraphrase-then-grammar')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 1, errors: 1, clarifications: 0, confirmations: 0
        });
        expect(counts('instantiate-place', 'no-point-then-point')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 1, errors: 0, clarifications: 1, confirmations: 0
        });

        expect(counts('connect-source-persona', 'wire-handle')).toEqual({
            completed: true, speechTurns: 0, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('connect-source-persona', 'grammar')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 0, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('connect-source-persona', 'paraphrase')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 0, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('connect-source-persona', 'deixis')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('connect-source-persona', 'disconnect-then-retry')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 0, errors: 1, clarifications: 0, confirmations: 0
        });
        expect(counts('connect-source-persona', 'ambiguous-target')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 0, errors: 0, clarifications: 1, confirmations: 0
        });

        expect(counts('open-shell', 'shell-panel')).toEqual({
            completed: true, speechTurns: 0, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('open-shell', 'grammar')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 0, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('open-shell', 'paraphrase')).toEqual({
            completed: true, speechTurns: 1, pointerActs: 0, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('open-shell', 'paraphrase-under-grammar')).toEqual({
            completed: false, speechTurns: 1, pointerActs: 0, errors: 1, clarifications: 0, confirmations: 0
        });

        expect(counts('delete-with-confirmation', 'close-control')).toEqual({
            completed: true, speechTurns: 0, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 0
        });
        expect(counts('delete-with-confirmation', 'grammar')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 1
        });
        expect(counts('delete-with-confirmation', 'named')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 0, errors: 0, clarifications: 0, confirmations: 1
        });
        expect(counts('delete-with-confirmation', 'paraphrase')).toEqual({
            completed: true, speechTurns: 2, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 1
        });
        expect(counts('delete-with-confirmation', 'filler-then-confirm')).toEqual({
            completed: true, speechTurns: 3, pointerActs: 1, errors: 1, clarifications: 0, confirmations: 1
        });
        expect(counts('delete-with-confirmation', 'interrupted-then-retry')).toEqual({
            completed: true, speechTurns: 3, pointerActs: 1, errors: 0, clarifications: 0, confirmations: 1
        });

        const report = readFileSync(join(import.meta.dirname, 'FIELD_REPORT.md'), 'utf8');
        const table = renderFieldTable(runs);
        expect(report).toContain(table);
        expect(report).toMatch(/scripted in-memory engine tasks are what was measured/i);
        expect(report).toMatch(/microphone latency: not measured/i);
        expect(report).toMatch(/OpenAI Realtime latency: not measured/i);
        expect(report).toMatch(/browser audio injection: not measured/i);
        expect(report).toMatch(/human preference: not measured/i);
        expect(report).toMatch(/places a block without a speech adapter|no speech adapter constructed/i);
        expect(report).not.toMatch(/p50|p95|%/i);
    });

    it('counts a preference only when a person supplied one', () => {
        expect(summarizePreferences([{
            participant: 'recorded-by-hand',
            task: 'open-shell',
            prefers: 'no preference',
            recordedAt: '2026-09-30'
        }])).toEqual({ speech: 0, pointer: 0, 'no preference': 1 });
    });

    it('places a block with no speech adapter constructed', () => {
        const canvas = buildScene('board');
        const engine = new InteractionEngine(canvas, () => CORPUS_CATALOG);
        const placed = engine.pointerCreate('hackernews_feed', { x: 640, y: 360 }, 'sidebar-drop');
        expect(placed.lifecycle).toBe('committed');
        expect(canvas.blocks.some(block => block.schema.block_id === 'hackernews_feed' && block.position.x === 640)).toBe(true);
        expect(engine.snapshot().traces.every(trace => trace.speechObservationId === undefined)).toBe(true);
    });
});
