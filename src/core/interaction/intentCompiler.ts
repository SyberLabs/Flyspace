// IntentCompiler: final transcript → proposal | needs-input | refuse.
// It returns data. It imports no store, no session, and no engine; the
// InteractionEngine is the only committer.

import { parseSpeech, type SpeechCatalog, type SpeechIntent } from './speech';
import type { ReferentExpression, SpatialCommandProposalV1 } from './proposal';
import type { SpeechObservationV1 } from './speechObservation';

/** Stable descriptors the host chooses to expose. Never the store itself. */
export interface IntentContext {
    activeShellId: string;
    vocabulary: SpeechCatalog;
    visibleBlocks: Array<{ id: string; name: string; blockId: string; tags: string[] }>;
    selection: string[];
}

type CompilerPath = 'grammar';

export type IntentCompilerResult =
    | { kind: 'proposal'; proposal: SpatialCommandProposalV1; via: CompilerPath }
    | { kind: 'needs-input'; question: string; reason: string; via: CompilerPath }
    | { kind: 'refuse'; reason: string; via: CompilerPath };

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
function intentToResult(intent: SpeechIntent, observationId: string, via: CompilerPath = 'grammar'): IntentCompilerResult {
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

export function createIntentCompiler(): IntentCompiler {
    return {
        async compile(observation, context) {
            return compileDeterministic(observation, context) ?? refuse('unrecognized-speech', 'grammar');
        }
    };
}
