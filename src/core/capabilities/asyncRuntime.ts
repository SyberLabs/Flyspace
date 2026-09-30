// Host-bound runtimes for the async_poll execution profile. A runtime starts
// an external job and reports what the destination says about it. It does
// not decide success, retry, or uncertainty: the executor does, from what was
// observed. Each start or poll request is still one bounded request.

export interface AsyncCall {
    /** Credential placement resolved from the manifest's slot for this call only. */
    headers: Record<string, string>;
    signal: AbortSignal;
    idempotencyKey: string;
}

export type AsyncObservation =
    | { status: 'running' }
    | { status: 'succeeded'; value: unknown }
    | { status: 'failed'; message?: string };

export interface AsyncJobRuntime {
    start(operation: string, args: Record<string, unknown>, call: AsyncCall): Promise<{ externalRunId: string }>;
    poll(operation: string, externalRunId: string, call: AsyncCall): Promise<AsyncObservation>;
}

/** Thrown by a runtime when the destination answered and refused the start. */
export class AsyncStartRejected extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AsyncStartRejected';
    }
}

export interface AsyncClock {
    now(): number;
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const systemClock: AsyncClock = {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    })
};

function abortError(): Error {
    const error = new Error('Polling was canceled');
    error.name = 'AbortError';
    return error;
}

export const EXTERNAL_RUN_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const MAX_CONSECUTIVE_POLL_ERRORS = 5;

const runtimes = new Map<string, AsyncJobRuntime>();

export function bindAsyncRuntime(runtimeId: string, runtime: AsyncJobRuntime): void {
    runtimes.set(runtimeId, runtime);
}

export function unbindAsyncRuntime(runtimeId: string): void {
    runtimes.delete(runtimeId);
}

export function asyncRuntime(runtimeId: string): AsyncJobRuntime | undefined {
    return runtimes.get(runtimeId);
}

export type PollOutcome =
    | { kind: 'succeeded'; value: unknown }
    | { kind: 'failed'; message: string }
    | { kind: 'canceled' }
    | { kind: 'deadline' }
    | { kind: 'unobservable'; message: string };

export interface PollPlan {
    runtime: AsyncJobRuntime;
    operation: string;
    externalRunId: string;
    headers: Record<string, string>;
    idempotencyKey: string;
    pollIntervalMs: number;
    deadlineAt: number;
    requestTimeoutMs: number;
    clock: AsyncClock;
    signal?: AbortSignal;
    onObserve(status: 'running' | 'succeeded' | 'failed', at: number): void;
}

/**
 * Observe an external run until it reports a terminal status, the deadline
 * passes, observation keeps failing, or the caller cancels. Always polls at
 * least once. Never calls start.
 */
export async function pollUntilSettled(plan: PollPlan): Promise<PollOutcome> {
    let failures = 0;
    let lastError = '';
    for (let first = true; ; first = false) {
        if (plan.signal?.aborted) return { kind: 'canceled' };
        if (!first) {
            if (plan.clock.now() >= plan.deadlineAt) return { kind: 'deadline' };
            try {
                await plan.clock.sleep(plan.pollIntervalMs, plan.signal);
            } catch {
                return { kind: 'canceled' };
            }
            if (plan.signal?.aborted) return { kind: 'canceled' };
        }
        const timeout = AbortSignal.timeout(plan.requestTimeoutMs);
        const signal = plan.signal ? AbortSignal.any([plan.signal, timeout]) : timeout;
        let observation: AsyncObservation;
        try {
            observation = await plan.runtime.poll(plan.operation, plan.externalRunId, {
                headers: { ...plan.headers },
                signal,
                idempotencyKey: plan.idempotencyKey
            });
        } catch (error) {
            if (plan.signal?.aborted) return { kind: 'canceled' };
            failures += 1;
            lastError = error instanceof Error ? error.message : 'poll failed';
            if (failures >= MAX_CONSECUTIVE_POLL_ERRORS) return { kind: 'unobservable', message: lastError };
            continue;
        }
        failures = 0;
        const at = plan.clock.now();
        if (observation.status === 'succeeded') {
            plan.onObserve('succeeded', at);
            return { kind: 'succeeded', value: observation.value };
        }
        if (observation.status === 'failed') {
            plan.onObserve('failed', at);
            return { kind: 'failed', message: observation.message ?? 'The external run failed' };
        }
        plan.onObserve('running', at);
    }
}
