'use client';

import type { CapabilityInput } from '@/core/capabilities/manifest';
import { looksLikeKey } from '@/core/capabilities/credentialName';
import type { ValueType } from '@/core/capabilities/valueType';

export { looksLikeKey };

/** What one field holds while being edited: text, or a checkbox's boolean. */
type FieldDraft = string | boolean;
/** A body laid out as fields keeps one draft per property. */
type Draft = FieldDraft | Record<string, FieldDraft>;

/** A body this many properties wide or less, all of them plain values, gets a field each. */
const MAX_BODY_FIELDS = 20;
const PLAIN_KINDS = new Set(['string', 'number', 'integer', 'boolean']);

function isDraftRecord(value: unknown): value is Record<string, FieldDraft> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The properties of a JSON body that can each be a field: an object whose
 * properties are all plain values. Anything nested stays one JSON box.
 */
export function bodyFields(input: CapabilityInput): CapabilityInput[] | null {
    if (input.in !== 'body' || input.schema.kind !== 'object' || !input.schema.properties) return null;
    const entries = Object.entries(input.schema.properties);
    if (entries.length === 0 || entries.length > MAX_BODY_FIELDS) return null;
    if (!entries.every(([, schema]) => PLAIN_KINDS.has(schema.kind))) return null;
    const required = new Set(input.schema.required ?? []);
    return entries.map(([name, schema]: [string, ValueType]) => ({ name, in: 'body', required: required.has(name), schema }));
}

/**
 * A field's typed argument, or undefined when empty. Applied when a run is
 * built, not on each keystroke: the block keeps exactly what was typed, so
 * "1." stays "1." while you are still typing a decimal.
 */
export function coerceInput(input: CapabilityInput, draft: unknown): unknown {
    const kind = input.schema.kind;
    if (kind === 'boolean') return typeof draft === 'boolean' ? draft : undefined;
    const fields = bodyFields(input);
    if (fields && isDraftRecord(draft)) {
        const body: Record<string, unknown> = {};
        for (const field of fields) {
            const value = coerceInput(field, draft[field.name]);
            if (value !== undefined) body[field.name] = value;
        }
        return Object.keys(body).length > 0 ? body : undefined;
    }
    if (typeof draft !== 'string') return draft === null ? undefined : draft;
    if (draft.trim() === '') return undefined;
    if (input.schema.enum) {
        const match = input.schema.enum.find(option => String(option) === draft);
        return match === undefined ? draft : match;
    }
    if (kind === 'number' || kind === 'integer') {
        const value = Number(draft);
        return Number.isFinite(value) ? value : draft;
    }
    if (kind === 'object' || kind === 'array') {
        try {
            return JSON.parse(draft);
        } catch {
            return draft; // left as text: validation names the problem on run
        }
    }
    return draft;
}

/**
 * A required input with exactly one allowed value is not a choice: FRED's
 * `file_type` must be `json`. It is sent without a field.
 */
export function constantOf(input: CapabilityInput): { value: unknown } | null {
    const options = input.schema.enum;
    return input.required && options?.length === 1 ? { value: options[0] } : null;
}

/** Typed arguments for every filled field, and every constant. Empty fields are left to wires. */
export function argumentsFrom(inputs: readonly CapabilityInput[], params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const input of inputs) {
        const constant = constantOf(input);
        if (constant) {
            out[input.name] = constant.value;
            continue;
        }
        if (!Object.hasOwn(params, input.name)) continue;
        const value = coerceInput(input, params[input.name]);
        if (value !== undefined) out[input.name] = value;
    }
    return out;
}

/** The text a field shows for a stored value. */
function draftOf(value: unknown): FieldDraft {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function isFilled(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (isDraftRecord(value)) return Object.values(value).some(isFilled);
    return true;
}

/** `city` → `City`, `start_date` → `Start date`. */
function labelOf(name: string): string {
    const spaced = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Inputs that still need a value before a run: required, not filled, not
 * wired. A body laid out as fields names its own missing properties.
 */
export function missingInputs(
    inputs: readonly CapabilityInput[],
    params: Record<string, unknown>,
    wired: Record<string, unknown>
): CapabilityInput[] {
    return inputs.flatMap(input => {
        if (constantOf(input) || wired[input.name] !== undefined) return [];
        const own = params[input.name];
        const fields = bodyFields(input);
        if (fields && (input.required || isFilled(own))) {
            const drafts = isDraftRecord(own) ? own : {};
            return fields.filter(field => field.required && !isFilled(drafts[field.name]));
        }
        return input.required && !isFilled(own) ? [input] : [];
    });
}

/** `city Seattle · state WA`: what a folded set of inputs was run with. */
export function inputSummaryOf(inputs: readonly CapabilityInput[], params: Record<string, unknown>): string {
    const shown = (input: CapabilityInput, value: unknown) =>
        `${input.name} ${!isFilled(value) ? '—' : looksLikeKey(input.name, input.schema.description) ? '••••' : String(value)}`;
    return inputs.flatMap(input => {
        if (constantOf(input)) return [];
        const value = params[input.name];
        const fields = bodyFields(input);
        if (fields) {
            const drafts = isDraftRecord(value) ? value : {};
            return fields.filter(field => field.required || isFilled(drafts[field.name])).map(field => shown(field, drafts[field.name]));
        }
        if (!isFilled(value) && !input.required) return []; // an unset optional input is not worth a slot
        return [shown(input, value)];
    }).join(' · ');
}

const FIELD_CLASS = 'w-full rounded-md border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--citadel-primary)] focus:outline-none';

/** What a blank field shows: the wired value, else the spec's example, else its default. */
function placeholderOf(input: CapabilityInput, wiredValue: unknown): string {
    if (wiredValue !== undefined) {
        return `from wire: ${String(typeof wiredValue === 'object' ? JSON.stringify(wiredValue) : wiredValue).slice(0, 60)}`;
    }
    if (input.example !== undefined) return `e.g. ${String(input.example)}`;
    if (input.default !== undefined) return `default: ${String(input.default)}`;
    if (input.schema.format === 'date-time') return 'e.g. 2026-10-07T12:00:00Z';
    return '';
}

function Field({ input, idPrefix, value, wiredValue, onChange, disabled }: {
    input: CapabilityInput;
    idPrefix: string;
    value: unknown;
    wiredValue: unknown;
    onChange: (draft: FieldDraft) => void;
    disabled?: boolean;
}) {
    const id = `${idPrefix}${input.name}`;
    const helpId = `${id}-help`;
    const draft = draftOf(value);
    const placeholder = placeholderOf(input, wiredValue);
    const keyLike = looksLikeKey(input.name, input.schema.description);
    const description = input.schema.description?.trim();
    const label = (
        <span className="text-[11px] text-[var(--text-muted)]">
            {labelOf(input.name)}
            {input.required ? <span aria-hidden="true" className="ml-0.5 text-[var(--truth-amber)]">*</span> : null}
        </span>
    );
    const help = description ? (
        <span id={helpId} title={description} className="line-clamp-2 block text-[10px] leading-snug text-[var(--text-muted)]">
            {description}
        </span>
    ) : null;
    const describedBy = description ? helpId : undefined;

    if (input.schema.kind === 'boolean') {
        return (
            <div>
                <label htmlFor={id} className="flex items-center gap-2">
                    <input
                        id={id}
                        type="checkbox"
                        checked={draft === true}
                        disabled={disabled}
                        aria-describedby={describedBy}
                        onChange={event => onChange(event.target.checked)}
                    />
                    {label}
                </label>
                {help}
            </div>
        );
    }

    return (
        <div className="space-y-0.5">
            <label htmlFor={id} className="block">{label}</label>
            {input.schema.enum ? (
                <select
                    id={id}
                    value={typeof draft === 'string' ? draft : ''}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    onChange={event => onChange(event.target.value)}
                    className={FIELD_CLASS}
                >
                    <option value="">
                        {wiredValue !== undefined ? placeholder : input.default !== undefined ? `Default (${String(input.default)})` : 'Choose…'}
                    </option>
                    {input.schema.enum.map(option => (
                        <option key={String(option)} value={String(option)}>{String(option)}</option>
                    ))}
                </select>
            ) : input.schema.kind === 'object' || input.schema.kind === 'array' ? (
                <textarea
                    id={id}
                    rows={2}
                    value={typeof draft === 'string' ? draft : ''}
                    placeholder={placeholder || (input.schema.kind === 'array' ? '["…"]' : '{ … }')}
                    disabled={disabled}
                    aria-describedby={describedBy}
                    onChange={event => onChange(event.target.value)}
                    className={`${FIELD_CLASS} font-mono`}
                />
            ) : (
                <input
                    id={id}
                    type={keyLike ? 'password' : input.schema.kind === 'number' || input.schema.kind === 'integer' ? 'number' : input.schema.format === 'date' ? 'date' : 'text'}
                    step={input.schema.kind === 'integer' ? 1 : input.schema.kind === 'number' ? 'any' : undefined}
                    value={typeof draft === 'string' ? draft : ''}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    aria-describedby={describedBy}
                    onChange={event => onChange(event.target.value)}
                    className={FIELD_CLASS}
                />
            )}
            {help}
            {keyLike ? (
                <span className="block text-[10px] text-[var(--truth-amber)]">
                    Looks like a key. It is saved with this canvas, unlike keys asked for at install.
                </span>
            ) : null}
        </div>
    );
}

export interface CapabilityInputsProps {
    inputs: readonly CapabilityInput[];
    params: Record<string, unknown>;
    /** Values arriving on wires. A typed value overrides them. */
    wired: Record<string, unknown>;
    /** The raw draft: text, a checkbox's boolean, or a body's drafts by property. Coerced at run time. */
    onChange: (name: string, draft: Draft) => void;
    disabled?: boolean;
}

/** One entry in the form: a plain input, or one property of a body laid out as fields. */
interface Slot {
    key: string;
    field: CapabilityInput;
    idPrefix: string;
    value: unknown;
    wiredValue: unknown;
    set: (draft: FieldDraft) => void;
}

/**
 * One field per input the operation declares, typed from its schema, with
 * the spec's own description under it. Required inputs come first; optional
 * ones fold away until wanted. What you type is kept on the block (`params`)
 * and wins over a wired value; an emptied field falls back to the wire.
 */
export function CapabilityInputs({ inputs, params, wired, onChange, disabled }: CapabilityInputsProps) {
    if (inputs.every(input => constantOf(input))) return null;

    const slots: Slot[] = inputs.filter(input => !constantOf(input)).flatMap(input => {
        const fields = bodyFields(input);
        if (!fields) {
            return [{
                key: input.name, field: input, idPrefix: 'cap-input-', value: params[input.name], wiredValue: wired[input.name],
                set: (draft: FieldDraft) => onChange(input.name, draft)
            }];
        }
        const drafts = isDraftRecord(params[input.name]) ? params[input.name] as Record<string, FieldDraft> : {};
        return fields.map(field => ({
            key: `body.${field.name}`,
            // A property of an optional body is optional, whatever the body says of it.
            field: input.required ? field : { ...field, required: false },
            idPrefix: 'cap-body-',
            value: drafts[field.name],
            wiredValue: undefined,
            set: (draft: FieldDraft) => onChange(input.name, { ...drafts, [field.name]: draft })
        }));
    });

    const required = slots.filter(slot => slot.field.required);
    const optional = slots.filter(slot => !slot.field.required);
    const render = (slot: Slot) => (
        <Field key={slot.key} input={slot.field} idPrefix={slot.idPrefix} value={slot.value} wiredValue={slot.wiredValue} onChange={slot.set} disabled={disabled} />
    );
    // Open when nothing is required, or when an optional input already has a value.
    const openOptional = required.length === 0 || optional.some(slot => isFilled(slot.value));

    return (
        <div className="space-y-2">
            {required.map(render)}
            {optional.length > 0 ? (
                <details open={openOptional} className="space-y-2">
                    <summary className="cursor-pointer text-[11px] text-[var(--text-secondary)]">Optional · {optional.length}</summary>
                    <div className="mt-1.5 space-y-2">{optional.map(render)}</div>
                </details>
            ) : null}
        </div>
    );
}
