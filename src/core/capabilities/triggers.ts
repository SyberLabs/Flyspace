// Execution triggers. Mounting a React view is not one of them.
// on_create fires once per block instance. interval and input changes are
// schedules. write and destructive capabilities stay manual.

import type { CapabilityTrigger } from './manifest';

/** Stable idempotency key for one scheduled firing. A repeat of the same slot replays. */
export function triggerIdempotencyKey(kind: CapabilityTrigger['kind'], instanceId: string, slot: string): string {
    const raw = `${kind}_${instanceId}_${slot}`.replace(/[^A-Za-z0-9._~-]/g, '_');
    return raw.length >= 8 ? raw.slice(0, 128) : `${raw}_trigger`;
}
