// SpatialCommandProposal v1: what the speech grammar hands the engine.

type ProposalOperation = 'CREATE' | 'MOVE' | 'CONNECT' | 'DELETE' | 'OPEN_SHELL' | 'BRANCH' | 'CRYSTALLIZE' | 'UNDO' | 'CANCEL' | 'CONFIRM';

export type ReferentExpression =
    | { kind: 'deictic'; word: 'this' | 'these' }
    | { kind: 'named'; name: string }
    | { kind: 'candidate'; id: string }
    | { kind: 'block-type'; blockId: string }
    | { kind: 'shell'; shellId: string };

type SpatialRelationExpression = { kind: 'pointed' } | { kind: 'default' };

export interface SpatialCommandProposalV1 {
    version: 1;
    operation: ProposalOperation;
    subject?: ReferentExpression;
    target?: ReferentExpression;
    placement?: SpatialRelationExpression;
    evidence: { speechObservationId: string };
}
