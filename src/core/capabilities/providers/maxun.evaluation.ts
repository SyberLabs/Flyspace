// What this repository has measured about Maxun. `measured: true` is written
// only after a real Maxun run in the session that commits it. Fixture tests
// prove Omni's async lifecycle; they are not a measurement of Maxun.

export type MaxunEvaluation =
    | { measured: false; reason: 'MAXUN_API_KEY unset' }
    | {
        measured: true;
        measuredAt: string;
        robotMode: 'scrape' | 'extract';
        startToTerminalMs: number;
        pollCount: number;
        outcome: 'succeeded' | 'failed' | 'uncertain';
        typedOutputValid: boolean;
    };

export const maxunEvaluation: MaxunEvaluation = { measured: false, reason: 'MAXUN_API_KEY unset' };
