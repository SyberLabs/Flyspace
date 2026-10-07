'use client';

import type { CapabilityInput } from '@/core/capabilities/manifest';

/** What a field holds while being edited: always text, coerced on the way out. */
type Draft = string | boolean;

/**
 * A field's typed argument, or undefined when empty. Applied when a run is
 * built, not on each keystroke: the block keeps exactly what was typed, so
 * "1." stays "1." while you are still typing a decimal.
 */
export function coerceInput(input: CapabilityInput, draft: unknown): unknown {
    const kind = input.schema.kind;
    if (kind === 'boolean') return typeof draft === 'boolean' ? draft : undefined;
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

/** Typed arguments for every filled field. Empty fields are left to wires. */
export function argumentsFrom(inputs: readonly CapabilityInput[], params: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const input of inputs) {
        if (!Object.hasOwn(params, input.name)) continue;
        const value = coerceInput(input, params[input.name]);
        if (value !== undefined) out[input.name] = value;
    }
    return out;
}

/** The text a field shows for a stored value. */
function draftOf(value: unknown): Draft {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * Names that usually carry a credential. Some specs pass their key as an
 * ordinary parameter (Interzoid's `license`) instead of declaring a security
 * scheme, so it arrives here as a plain input and is saved with the block.
 * OmniOS cannot know for certain, so it masks the field and says so.
 */
const KEY_LIKE = /(^|[_\-.])(api[_-]?key|apikey|key|token|access[_-]?token|secret|license|licence|password|passwd|auth)($|[_\-.])/i;

export function looksLikeKey(name: string): boolean {
    return KEY_LIKE.test(name);
}

/** `city` → `City`, `start_date` → `Start date`. */
function labelOf(name: string): string {
    const spaced = name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Inputs that still need a value before a run: required, not filled, not wired. */
export function missingInputs(
    inputs: readonly CapabilityInput[],
    params: Record<string, unknown>,
    wired: Record<string, unknown>
): CapabilityInput[] {
    return inputs.filter(input => {
        if (!input.required) return false;
        const own = params[input.name];
        if (own !== undefined && own !== '' && (typeof own !== 'string' || own.trim() !== '')) return false;
        return wired[input.name] === undefined;
    });
}

export interface CapabilityInputsProps {
    inputs: readonly CapabilityInput[];
    params: Record<string, unknown>;
    /** Values arriving on wires. A typed value overrides them. */
    wired: Record<string, unknown>;
    /** The raw draft: text, or a checkbox's boolean. Coerced at run time. */
    onChange: (name: string, draft: Draft) => void;
    disabled?: boolean;
}

/**
 * One field per input the operation declares, typed from its schema. What
 * you type is kept on the block (`params`) and wins over a wired value; an
 * emptied field falls back to the wire.
 */
export function CapabilityInputs({ inputs, params, wired, onChange, disabled }: CapabilityInputsProps) {
    if (inputs.length === 0) return null;
    return (
        <div className="space-y-1.5">
            {inputs.map(input => {
                const id = `cap-input-${input.name}`;
                const draft = draftOf(params[input.name]);
                const wiredValue = wired[input.name];
                const placeholder = wiredValue !== undefined
                    ? `from wire: ${String(typeof wiredValue === 'object' ? JSON.stringify(wiredValue) : wiredValue).slice(0, 60)}`
                    : input.schema.description?.slice(0, 80) ?? '';
                const label = (
                    <span className="text-[11px] text-[var(--text-muted)]">
                        {labelOf(input.name)}
                        {input.required ? <span aria-hidden="true" className="ml-0.5 text-[var(--truth-amber)]">*</span> : null}
                    </span>
                );
                const fieldClass = 'w-full rounded-md border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] px-2 py-1 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--citadel-primary)] focus:outline-none';

                if (input.schema.kind === 'boolean') {
                    return (
                        <label key={input.name} htmlFor={id} className="flex items-center gap-2">
                            <input
                                id={id}
                                type="checkbox"
                                checked={draft === true}
                                disabled={disabled}
                                onChange={event => onChange(input.name, event.target.checked)}
                            />
                            {label}
                        </label>
                    );
                }

                return (
                    <label key={input.name} htmlFor={id} className="block space-y-0.5">
                        {label}
                        {input.schema.enum ? (
                            <select
                                id={id}
                                value={typeof draft === 'string' ? draft : ''}
                                disabled={disabled}
                                onChange={event => onChange(input.name, event.target.value)}
                                className={fieldClass}
                            >
                                <option value="">{wiredValue !== undefined ? placeholder : 'Choose…'}</option>
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
                                onChange={event => onChange(input.name, event.target.value)}
                                className={`${fieldClass} font-mono`}
                            />
                        ) : (
                            <input
                                id={id}
                                type={looksLikeKey(input.name) ? 'password' : input.schema.kind === 'number' || input.schema.kind === 'integer' ? 'number' : input.schema.format === 'date' ? 'date' : 'text'}
                                step={input.schema.kind === 'integer' ? 1 : undefined}
                                value={typeof draft === 'string' ? draft : ''}
                                placeholder={placeholder}
                                disabled={disabled}
                                autoComplete="off"
                                onChange={event => onChange(input.name, event.target.value)}
                                className={fieldClass}
                            />
                        )}
                        {looksLikeKey(input.name) ? (
                            <span className="block text-[10px] text-[var(--truth-amber)]">
                                Looks like a key. It is saved with this canvas, unlike keys asked for at install.
                            </span>
                        ) : null}
                    </label>
                );
            })}
        </div>
    );
}
