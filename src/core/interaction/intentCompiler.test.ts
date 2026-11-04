import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InteractionEngine } from './engine';
import {
    compileDeterministic,
    createIntentCompiler,
    type IntentCompilerResult,
    type IntentContext,
} from './intentCompiler';
import { scriptedSpeechAdapter } from './scriptedSpeechAdapter';
import { createSpeechInput } from './speechInput';
import { observationFactory, type SpeechObservationV1 } from './speechObservation';
import {
    buildScene,
    COMPILER_CONFIGS,
    CORPUS_CATALOG,
    expectationFor,
    playUtterance,
    UTTERANCE_CORPUS,
    UTTERANCE_CORPUS_VERSION,
    type UtteranceClass
} from './utterances';

let session = 0;
function finalObservation(transcript: string): SpeechObservationV1 {
    session += 1;
    return observationFactory({ sessionId: `test-${session}`, provider: { adapterId: 'test' }, startedAtMs: 1 })({ transcript, final: true });
}

function boardEngine() {
    const canvas = buildScene('board');
    const engine = new InteractionEngine(canvas, () => CORPUS_CATALOG);
    return { canvas, engine };
}

describe('utterance corpus', () => {
    it('is versioned and covers every spec §16 class', () => {
        expect(UTTERANCE_CORPUS_VERSION).toBe(1);
        const classes = new Set(UTTERANCE_CORPUS.map(item => item.class));
        for (const required of ['deterministic', 'deixis', 'ambiguity', 'adversarial', 'degradation'] as UtteranceClass[]) {
            expect(classes.has(required)).toBe(true);
        }
        const lines = UTTERANCE_CORPUS.map(item => item.transcript);
        for (const line of ['undo', 'cancel', 'confirm', 'add Hacker News', 'wire Hacker News to the analyst',
            'delete everything', 'approve every API', 'ignore the confirmation step', 'yeah']) {
            expect(lines).toContain(line);
        }
        expect(new Set(UTTERANCE_CORPUS.map(item => item.id)).size).toBe(UTTERANCE_CORPUS.length);
    });

    it('never mentions a verb the engine cannot perform', () => {
        for (const item of UTTERANCE_CORPUS) {
            expect(item.transcript ?? '').not.toMatch(/\b(?:group|compare|keep apart|connect these)\b/i);
        }
    });

    for (const config of COMPILER_CONFIGS) {
        describe(config, () => {
            it.each(UTTERANCE_CORPUS.map(item => [item.id, item] as const))('%s', async (_id, item) => {
                const want = expectationFor(item, config);
                const played = await playUtterance(item, config);
                const kind = played.outcome?.kind ?? 'none';
                expect(kind === 'cancelled' ? 'none' : kind).toBe(want.outcome);
                if (want.errorCode) expect(played.outcome).toMatchObject({ kind: 'error', code: want.errorCode });
                if (want.lifecycle) expect(played.command?.lifecycle).toBe(want.lifecycle);
                if (want.action) expect(played.command?.action).toBe(want.action);
                if (want.reason) expect(played.command?.reason).toBe(want.reason);
                if (want.blocksAfter !== undefined) expect(played.canvas.blocks).toHaveLength(want.blocksAfter);
                if (want.pendingAfter !== undefined) expect(played.engine.snapshot().preview !== null).toBe(want.pendingAfter);
                if (want.replayReason) {
                    expect(played.replay).toMatchObject({ lifecycle: 'refused', reason: want.replayReason });
                    expect(played.canvas.blocks).toHaveLength(want.blocksAfter ?? played.canvas.blocks.length);
                }
                if (played.command) {
                    expect(played.command.speech?.observationId).toBe(played.outcome?.kind === 'command' ? played.outcome.observation.observationId : undefined);
                }
            });
        });
    }

    it('speak() and hear() agree on every line the grammar matches', async () => {
        const grammarLines = UTTERANCE_CORPUS.filter(item => item.transcript && !item.script && compileDeterministic(
            { transcript: item.transcript, observationId: 'x', final: true },
            { activeShellId: 'root', vocabulary: CORPUS_CATALOG, visibleBlocks: [], selection: [] }
        ));
        expect(grammarLines.length).toBeGreaterThan(10);
        for (const item of grammarLines) {
            const heard = await playUtterance(item, 'deterministic-only');
            const canvas = buildScene(item.scene);
            const engine = new InteractionEngine(canvas, () => CORPUS_CATALOG);
            if (item.selection) engine.select(item.selection);
            for (const line of item.before ?? []) engine.speak(line);
            for (const id of item.removeBeforeSpeaking ?? []) canvas.remove(id);
            if (item.pointAt) engine.notePoint({ frame: 'canvas', x: item.pointAt.x, y: item.pointAt.y }, Date.now());
            const spoken = engine.speak(item.transcript!);
            const shape = (command?: typeof spoken) => command && {
                lifecycle: command.lifecycle, action: command.action, reason: command.reason,
                subjects: command.subjects, target: command.target, summary: command.summary
            };
            expect(shape(heard.command), item.id).toEqual(shape(spoken));
            expect(heard.canvas.blocks.length, item.id).toBe(canvas.blocks.length);
            expect(heard.canvas.wires.length, item.id).toBe(canvas.wires.length);
        }
    });
});

describe('deterministic baseline', () => {
    it('resolves the fixed lines', async () => {
        const compiler = createIntentCompiler();
        const context: IntentContext = { activeShellId: 'root', vocabulary: CORPUS_CATALOG, visibleBlocks: [], selection: [] };
        for (const [line, operation] of [
            ['undo', 'UNDO'], ['cancel', 'CANCEL'], ['confirm', 'CONFIRM'],
            ['add Hacker News', 'CREATE'], ['wire Hacker News to the analyst', 'CONNECT']
        ] as const) {
            const result = await compiler.compile(finalObservation(line), context);
            expect(result).toMatchObject({ kind: 'proposal', via: 'grammar', proposal: { operation } });
        }
    });

    it('refuses a non-final observation before any parsing', async () => {
        const observation = { ...finalObservation('undo'), final: false };
        const result = await createIntentCompiler().compile(observation, {
            activeShellId: 'root', vocabulary: CORPUS_CATALOG, visibleBlocks: [], selection: []
        });
        expect(result).toEqual({ kind: 'refuse', reason: 'not-final', via: 'grammar' });
    });

});

describe('engine second gate', () => {
    it('refuses a result that claims the grammar but does not match it', () => {
        const { canvas, engine } = boardEngine();
        engine.select(['hn']);
        engine.speak('delete this');
        const observation = finalObservation('yeah');
        const forged: IntentCompilerResult = {
            kind: 'proposal', via: 'grammar',
            proposal: { version: 1, operation: 'CONFIRM', evidence: { speechObservationId: observation.observationId } }
        };
        expect(engine.admitSpeech(observation, forged)).toMatchObject({ lifecycle: 'refused', reason: 'grammar-mismatch' });
        expect(engine.snapshot().preview).not.toBeNull();
        expect(canvas.blocks).toHaveLength(2);
    });

    it('one session admits one result, whichever compiler produced it', async () => {
        const { canvas, engine } = boardEngine();
        const observation = finalObservation('add hacker news');
        const result = await createIntentCompiler().compile(observation, engine.describeSpeechContext());
        expect(engine.admitSpeech(observation, result).lifecycle).toBe('committed');
        expect(engine.admitSpeech(observation, result)).toMatchObject({ lifecycle: 'refused', reason: 'duplicate-final' });
        expect(engine.hear(observation)).toMatchObject({ lifecycle: 'refused', reason: 'duplicate-final' });
        expect(canvas.blocks).toHaveLength(3);
    });

    it('the context carries the active shell only', () => {
        const { canvas, engine } = boardEngine();
        canvas.blocks[0].shellId = 'elsewhere';
        engine.select(['hn', 'analyst']);
        const context = engine.describeSpeechContext();
        expect(context.visibleBlocks.map(block => block.id)).toEqual(['analyst']);
        expect(context.selection).toEqual(['analyst']);
    });
});

describe('speech input with an async compiler', () => {
    it('Escape during compilation drops the result', async () => {
        const { canvas, engine } = boardEngine();
        let release: (value: IntentCompilerResult) => void = () => {};
        const input = createSpeechInput({
            adapter: scriptedSpeechAdapter({ final: 'add hacker news' }),
            authority: engine,
            compiler: { compile: () => new Promise(resolve => { release = resolve; }) }
        });
        await input.press();
        const pending = input.release();
        await new Promise(resolve => setTimeout(resolve, 0));
        input.cancel();
        release({ kind: 'refuse', reason: 'late', via: 'grammar' });
        await expect(pending).resolves.toEqual({ kind: 'cancelled' });
        expect(engine.snapshot().commands).toHaveLength(0);
        expect(canvas.blocks).toHaveLength(2);
    });
});

describe('compiler isolation', () => {
    const dir = join(process.cwd(), 'src/core/interaction');
    it.each(['intentCompiler.ts', 'proposal.ts'])('%s imports no store, session, engine, or capability', file => {
        const source = readFileSync(join(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const imports = [...source.matchAll(/^import[^;]*?from '([^']+)'/gm)].map(match => match[1]);
        expect(imports.every(path => ['./speech', './proposal', './speechObservation'].includes(path))).toBe(true);
        expect(imports.some(path => /stores?|session|engine|capabilities/.test(path))).toBe(false);
        expect(source).not.toMatch(/\b(?:useBlockStore|useWireStore|useShellStore|spatialSession|InteractionEngine)\b/);
    });
});
