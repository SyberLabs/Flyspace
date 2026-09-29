// Execution triggers. Mounting a React view is not one of them.
// on_create fires once per block instance. interval and input changes are
// schedules. write and destructive capabilities stay manual.

import {
    triggerProblem,
    MIN_TRIGGER_INTERVAL_MS,
    MAX_TRIGGER_INTERVAL_MS,
    type CapabilityEffect,
    type CapabilityTrigger
} from './manifest';

export const MIN_INTERVAL_MS = MIN_TRIGGER_INTERVAL_MS;
export const MAX_INTERVAL_MS = MAX_TRIGGER_INTERVAL_MS;

const listeners = new Map<string, Set<() => void>>();

export function triggerIsLegal(effect: CapabilityEffect, trigger: CapabilityTrigger): string | null {
    return triggerProblem(effect, trigger);
}

export function subscribeCapabilityEvent(name: string, listener: () => void): () => void {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(name);
    };
}

export function emitCapabilityEvent(name: string): void {
    for (const listener of listeners.get(name) ?? []) listener();
}

/** Stable idempotency key for one scheduled firing. A repeat of the same slot replays. */
export function triggerIdempotencyKey(kind: CapabilityTrigger['kind'], instanceId: string, slot: string): string {
    const raw = `${kind}_${instanceId}_${slot}`.replace(/[^A-Za-z0-9._~-]/g, '_');
    return raw.length >= 8 ? raw.slice(0, 128) : `${raw}_trigger`;
}
