// ============================================
// SERVER TELEMETRY
//
// One JSON line per server event: {"event":"flyspace.<area>.<outcome>", ...}.
// telemetry/events.json is the allowlist. An event it does not name is not
// written. A field it does not list for that event is never read. A value
// outside the field's list becomes "other" where the list has it and is
// dropped where it does not.
//
// Error detail is the error's class name from a closed list (`kind`), never
// its message, stack, URL or payload: those can quote an upstream body, a
// prompt or a connection string, and a log line is kept somewhere the
// ledger's scrubbing does not reach.
//
// Errors go to console.error and everything else to console.log. Nothing here
// throws: a log line must never cost a request its answer.
// ============================================

import 'server-only';
import allowlist from '../../../../telemetry/events.json';

export type TelemetryEvent = keyof typeof allowlist.events;
export type TelemetryField = keyof typeof allowlist.fields;
export type TelemetryFields = Partial<Record<TelemetryField, string | number>>;

/** A closed list of strings, or an inclusive integer range. */
type FieldSpec = readonly string[] | { readonly integer: readonly number[] };

interface EventSpec {
    readonly level: string;
    readonly fields: readonly string[];
}

const EVENTS: Readonly<Record<string, EventSpec>> = allowlist.events;
const FIELDS: Readonly<Record<string, FieldSpec>> = allowlist.fields;
const KINDS: readonly string[] = allowlist.fields.kind;

/** The value as the allowlist permits it, or undefined to leave the field out. */
function admit(spec: FieldSpec | undefined, value: unknown): string | number | undefined {
    if (spec === undefined || value === undefined || value === null) return undefined;
    if ('integer' in spec) {
        const [min, max] = spec.integer;
        return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
            ? value
            : undefined;
    }
    if (typeof value === 'string' && spec.includes(value)) return value;
    return spec.includes('other') ? 'other' : undefined;
}

/**
 * The error's class name when the allowlist has it, otherwise "other". Only
 * `name` is read; the message is where an upstream body or a key would be.
 */
export function errorKind(error: unknown): string {
    try {
        const name = typeof error === 'object' && error !== null
            ? (error as { name?: unknown }).name
            : undefined;
        return typeof name === 'string' && KINDS.includes(name) ? name : 'other';
    } catch {
        return 'other';
    }
}

/**
 * Write one allowlisted event. Only the fields events.json lists for it are
 * looked up on `fields`, so anything else a caller passes is never read.
 */
export function logEvent(event: TelemetryEvent, fields?: TelemetryFields): void {
    try {
        if (!Object.hasOwn(EVENTS, event)) return;
        const spec = EVENTS[event];
        const given: Record<string, unknown> = fields ?? {};
        const line: Record<string, string | number> = { event };
        for (const name of spec.fields) {
            const value = admit(FIELDS[name], given[name]);
            if (value !== undefined) line[name] = value;
        }
        const text = JSON.stringify(line);
        if (spec.level === 'error') console.error(text);
        else console.log(text);
    } catch {
        // Telemetry is the cheaper loss.
    }
}
