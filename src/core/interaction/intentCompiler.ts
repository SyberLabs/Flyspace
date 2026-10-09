// IntentCompiler: final transcript → proposal | needs-input | refuse.
// It returns data. It imports no store, no session, and no engine; the
// InteractionEngine is the only committer.

import { parseSpeech, type SpeechCatalog, type SpeechIntent } from './speech';
import {
    PROPOSAL_OPERATIONS,
    RESERVED_OPERATIONS,
    validateProposal,
    type ReferentExpression,
    type SpatialCommandProposalV1
} from './proposal';
import type { SpeechObservationV1 } from './speechObservation';

/** Stable descriptors the host chooses to expose. Never the store itself. */
export interface IntentContext {
    activeShellId: string;
    vocabulary: SpeechCatalog;
    visibleBlocks: Array<{ id: string; name: string; blockId: string; tags: string[] }>;
    selection: string[];
}

export type CompilerPath = 'grammar' | 'semantic' | 'model';

export type IntentCompilerResult =
    | { kind: 'proposal'; proposal: SpatialCommandProposalV1; via: CompilerPath }
    | { kind: 'needs-input'; question: string; reason: string; via: CompilerPath }
    | { kind: 'refuse'; reason: string; via: CompilerPath };

export interface SemanticInput {
    transcript: string;
    observationId: string;
    context: IntentContext;
}

/** The step that runs only when the grammar has no exact match. */
export interface SemanticCompiler {
    readonly id: string;
    compile(input: SemanticInput): IntentCompilerResult | null | Promise<IntentCompilerResult | null>;
}

export interface IntentCompiler {
    compile(observation: SpeechObservationV1, context: IntentContext): Promise<IntentCompilerResult>;
}

const MAX_UTTERANCE_CHARS = 160;

/**
 * Lines that ask for more authority than the command vocabulary has.
 * Checked before the grammar, so "delete everything" is refused rather than
 * treated as a block named "everything".
 */
export function outOfScopeReason(transcript: string): string | null {
    const text = transcript.trim().toLowerCase();
    if (text.length > MAX_UTTERANCE_CHARS) return 'utterance-too-long';
    if (/\b(?:delete|remove|clear|wipe|erase|destroy|trash)\b.*\b(?:everything|all|every|entire|whole)\b/.test(text)) {
        return 'bulk-destructive-out-of-scope';
    }
    if (/\b(?:approve|authori[sz]e|grant|permit|allowlist|whitelist)\b/.test(text)) return 'authority-out-of-scope';
    if (/\b(?:ignore|skip|bypass|disable|override|without)\b.*\b(?:confirm\w*|preview|safety|checks?)\b/.test(text)) {
        return 'confirmation-bypass-refused';
    }
    if (/\b(?:don'?t|do not|never) (?:ask|confirm|check)\b|\bno confirm\w*\b/.test(text)) return 'confirmation-bypass-refused';
    return null;
}

function refuse(reason: string, via: CompilerPath): IntentCompilerResult {
    return { kind: 'refuse', reason, via };
}

function proposal(
    operation: SpatialCommandProposalV1['operation'],
    observationId: string,
    fields: Omit<SpatialCommandProposalV1, 'version' | 'operation' | 'evidence'> = {},
    via: CompilerPath = 'grammar'
): IntentCompilerResult {
    return { kind: 'proposal', via, proposal: { version: 1, operation, ...fields, evidence: { speechObservationId: observationId } } };
}

function deictic(word: SpeechIntent['deixis']): ReferentExpression {
    return { kind: 'deictic', word: word === 'these' ? 'these' : 'this' };
}

/** Lossless map from the fixed grammar's intent to a proposal. */
export function intentToResult(intent: SpeechIntent, observationId: string, via: CompilerPath = 'grammar'): IntentCompilerResult {
    if (intent.ambiguous === 'block') return { kind: 'needs-input', reason: 'ambiguous-block', question: 'Which block do you mean?', via };
    if (intent.ambiguous === 'shell') return { kind: 'needs-input', reason: 'ambiguous-shell', question: 'Which shell do you mean?', via };
    switch (intent.action) {
        case 'create':
            if (!intent.personaBlockId) return refuse('unrecognized-speech', via);
            return proposal('CREATE', observationId, {
                subject: { kind: 'block-type', blockId: intent.personaBlockId },
                placement: { kind: intent.deixis === 'here' ? 'pointed' : 'default' }
            }, via);
        case 'move':
            return proposal('MOVE', observationId, { subject: deictic('this'), placement: { kind: 'pointed' } }, via);
        case 'connect':
            if (!intent.targetName) return refuse('unrecognized-speech', via);
            return proposal('CONNECT', observationId, {
                subject: intent.sourceName ? { kind: 'named', name: intent.sourceName } : deictic(intent.deixis),
                target: { kind: 'named', name: intent.targetName }
            }, via);
        case 'delete':
            return proposal('DELETE', observationId, {
                subject: intent.targetName && intent.deixis === 'none' ? { kind: 'named', name: intent.targetName } : deictic('this')
            }, via);
        case 'branch':
            return proposal('BRANCH', observationId, { subject: deictic('this') }, via);
        case 'crystallize':
            return proposal('CRYSTALLIZE', observationId, { subject: deictic('this') }, via);
        case 'open-shell':
            if (!intent.shell) return refuse('unrecognized-speech', via);
            return proposal('OPEN_SHELL', observationId, { target: { kind: 'shell', shellId: intent.shell.id } }, via);
        case 'undo':
            return proposal('UNDO', observationId, {}, via);
        case 'cancel':
            return proposal('CANCEL', observationId, {}, via);
        case 'confirm':
            return proposal('CONFIRM', observationId, {}, via);
        default:
            return refuse('unrecognized-speech', via);
    }
}

/** The deterministic fast path. No model, no network, synchronous. Null means no exact match. */
export function compileDeterministic(observation: Pick<SpeechObservationV1, 'transcript' | 'observationId' | 'final'>, context: IntentContext): IntentCompilerResult | null {
    if (!observation.final) return refuse('not-final', 'grammar');
    const scope = outOfScopeReason(observation.transcript);
    if (scope) return refuse(scope, 'grammar');
    const intent = parseSpeech(observation.transcript, context.vocabulary);
    return intent ? intentToResult(intent, observation.observationId) : null;
}

export function createIntentCompiler(options: { semantic?: SemanticCompiler | null } = {}): IntentCompiler {
    return {
        async compile(observation, context) {
            const fast = compileDeterministic(observation, context);
            if (fast) return fast;
            const semantic = options.semantic;
            if (!semantic) return refuse('unrecognized-speech', 'grammar');
            let result: IntentCompilerResult | null;
            try {
                result = await semantic.compile({ transcript: observation.transcript, observationId: observation.observationId, context });
            } catch {
                return refuse('semantic-compiler-failed', 'semantic');
            }
            if (!result) return refuse('unrecognized-speech', 'semantic');
            if (result.kind !== 'proposal') return result;
            const checked = validateProposal(result.proposal, {
                observationId: observation.observationId,
                vocabulary: context.vocabulary,
                allowReserved: false,
                candidateIds: new Set(context.visibleBlocks.map(block => block.id))
            });
            if (!checked.ok) return refuse(`invalid-proposal:${checked.reason}`, result.via);
            return { kind: 'proposal', proposal: checked.proposal, via: result.via };
        }
    };
}

// ---------------------------------------------------------------------------
// Strict paraphrase parser. A finite set of anchored patterns over the host
// vocabulary. Not a model; nothing here guesses.
// ---------------------------------------------------------------------------

const DEICTIC_WORDS = new Set(['this', 'that', 'it', 'these', 'those', 'here', 'there']);
const POLITE_PREFIX = /^(?:(?:hey |ok |okay )?omni,? |please |(?:can|could|would|will) you (?:please )?|i want you to |i'd like you to |let's )/;
const POLITE_SUFFIX = / (?:please|for me|now|thanks|thank you)$/;

function normalize(transcript: string): string {
    let text = transcript.trim().toLowerCase().replace(/[.?!,]+$/g, '').replace(/\s+/g, ' ');
    for (let pass = 0; pass < 4; pass += 1) {
        const next = text.replace(POLITE_PREFIX, '').replace(POLITE_SUFFIX, '').trim();
        if (next === text) break;
        text = next;
    }
    return text;
}

function cleanName(raw: string): string | null {
    const name = raw.replace(/^(?:the |a |an )/, '').replace(/ (?:block|feed block)$/, '').trim();
    if (!name || name.length > 80 || DEICTIC_WORDS.has(name)) return null;
    return name;
}

function vocabularyMatch(query: string, vocabulary: SpeechCatalog): { blockId: string } | 'ambiguous' | null {
    const matches = vocabulary.blocks.filter(block => block.aliases.includes(query) || block.displayName.toLowerCase() === query);
    if (matches.length === 1) return { blockId: matches[0].blockId };
    if (matches.length > 1) return 'ambiguous';
    return null;
}

export function paraphraseCompiler(): SemanticCompiler {
    return {
        id: 'strict-paraphrase-v1',
        compile({ transcript, observationId, context }) {
            const text = normalize(transcript);
            if (!text) return null;
            const via: CompilerPath = 'semantic';

            // Politeness around an exact grammar line. Reserved words stay grammar-only.
            if (text !== transcript.trim().toLowerCase().replace(/[.?!]+$/g, '')) {
                const intent = parseSpeech(text, context.vocabulary);
                if (intent && intent.action !== 'confirm' && intent.action !== 'undo' && intent.action !== 'cancel') {
                    return intentToResult(intent, observationId, via);
                }
            }

            const placed = text.match(/^(?:put|place|drop|add) (?:a |an |the )?(.+?) (?:over here|right here|over there|right there|here|there)$/);
            if (placed) {
                const name = cleanName(placed[1]);
                if (!name) return null;
                const match = vocabularyMatch(name, context.vocabulary);
                if (match === 'ambiguous') return { kind: 'needs-input', reason: 'ambiguous-block', question: 'Which block do you mean?', via };
                if (!match) return null;
                return proposal('CREATE', observationId, { subject: { kind: 'block-type', blockId: match.blockId }, placement: { kind: 'pointed' } }, via);
            }

            if (/^(?:move|drag|bring) (?:this|that|it) (?:over here|right here|over there|here|there)$/.test(text)) {
                return proposal('MOVE', observationId, { subject: deictic('this'), placement: { kind: 'pointed' } }, via);
            }

            if (/^(?:get rid of|throw away|trash) (?:this|that|it)$/.test(text)) {
                return proposal('DELETE', observationId, { subject: deictic('this') }, via);
            }

            const fed = text.match(/^(?:feed|send|pipe|route|hook up|plug) (?:the )?(.+?) (?:into|to|up to) (?:the )?(.+)$/);
            if (fed) {
                const target = cleanName(fed[2]);
                const sourceIsDeictic = /^(?:this|that|it)$/.test(fed[1]);
                const source = sourceIsDeictic ? null : cleanName(fed[1]);
                if (!target || (!source && !sourceIsDeictic)) return null;
                return proposal('CONNECT', observationId, {
                    subject: source ? { kind: 'named', name: source } : deictic('this'),
                    target: { kind: 'named', name: target }
                }, via);
            }

            const given = text.match(/^give (?:the )?(.+?) the (.+)$/);
            if (given) {
                const target = cleanName(given[1]);
                const source = cleanName(given[2]);
                if (!target || !source) return null;
                return proposal('CONNECT', observationId, {
                    subject: { kind: 'named', name: source },
                    target: { kind: 'named', name: target }
                }, via);
            }

            const brought = text.match(/^(?:bring in|pull in|import|fetch|get me) (?:some |the )?(.+?) (?:data|feed|api|numbers|prices)$/)
                ?? text.match(/^(?:bring in|pull in|import) data from (?:the )?(.+)$/);
            if (brought) {
                const query = cleanName(brought[1]);
                if (!query) return null;
                const known = vocabularyMatch(query, context.vocabulary);
                if (known && known !== 'ambiguous') {
                    return proposal('CREATE', observationId, { subject: { kind: 'block-type', blockId: known.blockId }, placement: { kind: 'default' } }, via);
                }
                return proposal('RESOLVE_CAPABILITY', observationId, { capabilityQuery: { text: query } }, via);
            }

            return null;
        }
    };
}

// ---------------------------------------------------------------------------
// Model boundary. The model function is injected; it receives bounded
// descriptors and must return one proposal object. Everything else is refused.
// ---------------------------------------------------------------------------

export interface ModelIntentRequest {
    objective: 'compile speech into one bounded Omni proposal';
    transcript: string;
    observationId: string;
    operations: string[];
    blockTypes: Array<{ blockId: string; displayName: string }>;
    shells: Array<{ shellId: string; name: string }>;
    candidates: Array<{ id: string; name: string; blockId: string }>;
    selection: string[];
}

export type IntentModel = (request: ModelIntentRequest) => unknown | Promise<unknown>;

const MAX_MODEL_CANDIDATES = 50;
const MAX_MODEL_OUTPUT_CHARS = 4000;

export function modelIntentCompiler(model: IntentModel): SemanticCompiler {
    return {
        id: 'model-intent-v1',
        async compile({ transcript, observationId, context }) {
            const candidates = context.visibleBlocks.slice(0, MAX_MODEL_CANDIDATES);
            const candidateIds = new Set(candidates.map(block => block.id));
            const request: ModelIntentRequest = {
                objective: 'compile speech into one bounded Omni proposal',
                transcript,
                observationId,
                operations: PROPOSAL_OPERATIONS.filter(operation => !RESERVED_OPERATIONS.has(operation)),
                blockTypes: context.vocabulary.blocks.map(block => ({ blockId: block.blockId, displayName: block.displayName })),
                shells: context.vocabulary.shells.map(shell => ({ shellId: shell.id, name: shell.name })),
                candidates: candidates.map(block => ({ id: block.id, name: block.name, blockId: block.blockId })),
                selection: context.selection.filter(id => candidateIds.has(id))
            };
            let output: unknown;
            try {
                output = await model(request);
            } catch {
                return refuse('model-error', 'model');
            }
            let parsed: unknown = output;
            if (typeof output === 'string') {
                if (output.length > MAX_MODEL_OUTPUT_CHARS) return refuse('model-output-too-long', 'model');
                try {
                    parsed = JSON.parse(output);
                } catch {
                    return refuse('model-output-invalid-json', 'model');
                }
            }
            const checked = validateProposal(parsed, {
                observationId,
                vocabulary: context.vocabulary,
                allowReserved: false,
                candidateIds
            });
            if (!checked.ok) return refuse(`model-output-invalid:${checked.reason}`, 'model');
            return { kind: 'proposal', proposal: checked.proposal, via: 'model' };
        }
    };
}
