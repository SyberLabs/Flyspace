// SpatialCommandProposal v1: the only shape a compiler may hand the engine.
// Validation is code. Unknown fields, unknown operations, and out-of-vocabulary
// references are refused, never repaired.

import type { SpeechCatalog } from './speech';

export const PROPOSAL_OPERATIONS = [
    'CREATE',
    'MOVE',
    'CONNECT',
    'DELETE',
    'OPEN_SHELL',
    'BRANCH',
    'CRYSTALLIZE',
    'UNDO',
    'CANCEL',
    'CONFIRM',
    'RESOLVE_CAPABILITY'
] as const;

export type ProposalOperation = typeof PROPOSAL_OPERATIONS[number];

/** Only the deterministic grammar may produce these. A model outage must not block them, and a model must not forge them. */
export const RESERVED_OPERATIONS: ReadonlySet<ProposalOperation> = new Set(['UNDO', 'CANCEL', 'CONFIRM']);

export type ReferentExpression =
    | { kind: 'deictic'; word: 'this' | 'these' }
    | { kind: 'named'; name: string }
    | { kind: 'candidate'; id: string }
    | { kind: 'block-type'; blockId: string }
    | { kind: 'shell'; shellId: string };

export type SpatialRelationExpression = { kind: 'pointed' } | { kind: 'default' };

export interface CapabilityQueryExpression {
    text: string;
}

export interface SpatialCommandProposalV1 {
    version: 1;
    operation: ProposalOperation;
    subject?: ReferentExpression;
    target?: ReferentExpression;
    placement?: SpatialRelationExpression;
    capabilityQuery?: CapabilityQueryExpression;
    evidence: { speechObservationId: string };
}

export interface ProposalRules {
    observationId: string;
    vocabulary: SpeechCatalog;
    /** Reserved operations are admitted only from the deterministic grammar. */
    allowReserved: boolean;
    /** When set, candidate ids must come from this supplied set. */
    candidateIds?: ReadonlySet<string>;
}

export type ProposalCheck = { ok: true; proposal: SpatialCommandProposalV1 } | { ok: false; reason: string };

const TOP_KEYS = new Set(['version', 'operation', 'subject', 'target', 'placement', 'capabilityQuery', 'evidence']);
const MAX_NAME = 80;
const MAX_QUERY = 120;

type Field = 'subject' | 'target' | 'placement' | 'capabilityQuery';
type ReferentKind = ReferentExpression['kind'];

const SHAPES: Record<ProposalOperation, Partial<Record<Field, ReferentKind[] | true>>> = {
    CREATE: { subject: ['block-type'], placement: true },
    MOVE: { subject: ['deictic', 'named', 'candidate'], placement: true },
    CONNECT: { subject: ['deictic', 'named', 'candidate'], target: ['named', 'candidate'] },
    DELETE: { subject: ['deictic', 'named', 'candidate'] },
    OPEN_SHELL: { target: ['shell'] },
    BRANCH: { subject: ['deictic', 'candidate'] },
    CRYSTALLIZE: { subject: ['deictic', 'candidate'] },
    UNDO: {},
    CANCEL: {},
    CONFIRM: {},
    RESOLVE_CAPABILITY: { capabilityQuery: true }
};

function plainObject(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
    const present = Object.keys(value);
    return present.length === keys.length && keys.every(key => present.includes(key));
}

function boundedText(value: unknown, max: number): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
}

function checkReferent(value: unknown, allowed: ReferentKind[], rules: ProposalRules, operation: ProposalOperation): string | null {
    if (!plainObject(value) || typeof value.kind !== 'string') return 'referent-shape';
    const kind = value.kind as ReferentKind;
    if (!allowed.includes(kind)) return `referent-kind-not-allowed:${String(value.kind)}`;
    switch (kind) {
        case 'deictic':
            if (!exactKeys(value, ['kind', 'word'])) return 'referent-shape';
            if (value.word !== 'this' && value.word !== 'these') return 'referent-shape';
            if (value.word === 'these' && operation !== 'CONNECT') return 'referent-set-not-allowed';
            return null;
        case 'named':
            if (!exactKeys(value, ['kind', 'name']) || !boundedText(value.name, MAX_NAME)) return 'referent-shape';
            return null;
        case 'candidate':
            if (!exactKeys(value, ['kind', 'id']) || !boundedText(value.id, 200)) return 'referent-shape';
            if (rules.candidateIds && !rules.candidateIds.has(value.id)) return 'candidate-not-supplied';
            return null;
        case 'block-type':
            if (!exactKeys(value, ['kind', 'blockId']) || typeof value.blockId !== 'string') return 'referent-shape';
            if (!rules.vocabulary.blocks.some(block => block.blockId === value.blockId)) return 'block-type-not-in-vocabulary';
            return null;
        case 'shell':
            if (!exactKeys(value, ['kind', 'shellId']) || typeof value.shellId !== 'string') return 'referent-shape';
            if (!rules.vocabulary.shells.some(shell => shell.id === value.shellId)) return 'shell-not-in-vocabulary';
            return null;
        default:
            return 'referent-shape';
    }
}

export function validateProposal(value: unknown, rules: ProposalRules): ProposalCheck {
    if (!plainObject(value)) return { ok: false, reason: 'not-an-object' };
    for (const key of Object.keys(value)) {
        if (!TOP_KEYS.has(key)) return { ok: false, reason: `unknown-field:${key}` };
    }
    if (value.version !== 1) return { ok: false, reason: 'version' };
    const operation = value.operation;
    if (typeof operation !== 'string' || !(PROPOSAL_OPERATIONS as readonly string[]).includes(operation)) {
        return { ok: false, reason: 'unknown-operation' };
    }
    const op = operation as ProposalOperation;
    if (RESERVED_OPERATIONS.has(op) && !rules.allowReserved) return { ok: false, reason: 'reserved-deterministic' };
    if (!plainObject(value.evidence) || !exactKeys(value.evidence, ['speechObservationId'])) return { ok: false, reason: 'evidence' };
    if (value.evidence.speechObservationId !== rules.observationId) return { ok: false, reason: 'evidence-mismatch' };

    const shape = SHAPES[op];
    for (const field of ['subject', 'target', 'placement', 'capabilityQuery'] as Field[]) {
        const expected = shape[field];
        const present = value[field] !== undefined;
        if (!expected) {
            if (present) return { ok: false, reason: `field-not-allowed:${field}` };
            continue;
        }
        if (!present) return { ok: false, reason: `missing-field:${field}` };
        if (field === 'placement') {
            const placement = value.placement;
            if (!plainObject(placement) || !exactKeys(placement, ['kind'])) return { ok: false, reason: 'placement-shape' };
            if (placement.kind !== 'pointed' && placement.kind !== 'default') return { ok: false, reason: 'placement-shape' };
            if (op === 'MOVE' && placement.kind !== 'pointed') return { ok: false, reason: 'placement-shape' };
            continue;
        }
        if (field === 'capabilityQuery') {
            const query = value.capabilityQuery;
            if (!plainObject(query) || !exactKeys(query, ['text']) || !boundedText(query.text, MAX_QUERY)) {
                return { ok: false, reason: 'capability-query-shape' };
            }
            continue;
        }
        const problem = checkReferent(value[field], expected as ReferentKind[], rules, op);
        if (problem) return { ok: false, reason: problem };
    }
    return { ok: true, proposal: structuredClone(value) as unknown as SpatialCommandProposalV1 };
}
