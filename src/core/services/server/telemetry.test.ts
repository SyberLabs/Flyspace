import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import allowlist from '../../../../telemetry/events.json';
import { errorKind, logEvent, type TelemetryEvent, type TelemetryFields } from './telemetry';
import { ProviderResponseError } from './llm.adapters';
import { PUBLIC_PROXY_IDS } from './public.providers';

const MARKER = 'MESSAGE-TEXT-MUST-NOT-BE-LOGGED';

let log: MockInstance<typeof console.log>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

/** Everything written to either sink, as one string. */
function everything(): string {
    return JSON.stringify([...log.mock.calls, ...error.mock.calls]);
}

describe('logEvent', () => {
    it('writes one JSON line: the event, then its allowlisted fields in list order', () => {
        logEvent('flyspace.source.failed', { status: 503, reason: 'status', provider: 'polymarket' });
        expect(log).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledWith('{"event":"flyspace.source.failed","provider":"polymarket","reason":"status","status":503}');
        expect(error).not.toHaveBeenCalled();
    });

    it('sends error events to console.error and every other event to console.log', () => {
        for (const [event, spec] of Object.entries(allowlist.events)) {
            log.mockClear();
            error.mockClear();
            logEvent(event as TelemetryEvent);
            const line = JSON.stringify({ event });
            if (spec.level === 'error') {
                expect(error).toHaveBeenCalledWith(line);
                expect(log).not.toHaveBeenCalled();
            } else {
                expect(log).toHaveBeenCalledWith(line);
                expect(error).not.toHaveBeenCalled();
            }
        }
    });

    it('drops a field the event does not list, even one another event allows', () => {
        logEvent('flyspace.registry_intent.failed', {
            reason: 'timeout',
            provider: 'polymarket',
            status: 500,
            kind: 'Error',
            query: 'runs',
            message: MARKER,
            url: `https://example.com/?q=${MARKER}`,
            stack: MARKER
        } as TelemetryFields);
        expect(log).toHaveBeenCalledWith('{"event":"flyspace.registry_intent.failed","reason":"timeout"}');
    });

    it('turns a value off the list into "other" where the list has it, and drops it where it does not', () => {
        logEvent('flyspace.source.failed', { provider: 'fred', reason: MARKER, status: 99, kind: MARKER });
        logEvent('flyspace.llm.failed', { llm_provider: MARKER, status: 600, kind: 'RangeError' });
        logEvent('flyspace.ledger.query_failed', { query: MARKER });
        expect(log.mock.calls).toEqual([
            ['{"event":"flyspace.source.failed","provider":"other","reason":"other","kind":"other"}']
        ]);
        expect(error.mock.calls).toEqual([
            ['{"event":"flyspace.llm.failed","kind":"other"}'],
            ['{"event":"flyspace.ledger.query_failed"}']
        ]);
    });

    it('keeps a status only when it is an HTTP status code', () => {
        for (const status of [99, 600, 502.5, Number.NaN, Number.POSITIVE_INFINITY, '502']) {
            logEvent('flyspace.source.failed', { provider: 'usgs', status: status as number });
        }
        logEvent('flyspace.source.failed', { provider: 'usgs', status: 100 });
        logEvent('flyspace.source.failed', { provider: 'usgs', status: 599 });
        expect(log.mock.calls.map(call => JSON.parse(call[0] as string).status)).toEqual([
            undefined, undefined, undefined, undefined, undefined, undefined, 100, 599
        ]);
    });

    it('writes nothing for an event the allowlist does not name', () => {
        for (const event of ['flyspace.made.up', 'constructor', '__proto__', 'toString', '']) {
            logEvent(event as TelemetryEvent, { reason: 'timeout' });
        }
        expect(log).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('never throws, whatever it is handed or wherever the line goes', () => {
        const hostile = new Proxy({}, { get() { throw new Error(MARKER); } });
        const getter = { get provider(): string { throw new Error(MARKER); } };
        expect(() => logEvent('flyspace.source.failed', hostile as TelemetryFields)).not.toThrow();
        expect(() => logEvent('flyspace.source.failed', getter)).not.toThrow();
        expect(() => logEvent('flyspace.source.failed', null as unknown as TelemetryFields)).not.toThrow();
        expect(log).toHaveBeenCalledWith('{"event":"flyspace.source.failed"}');

        error.mockImplementation(() => { throw new Error('the sink is down'); });
        expect(() => logEvent('flyspace.llm.failed', { kind: 'Error' })).not.toThrow();
        expect(everything()).not.toContain(MARKER);
    });

    it('never writes message text, whichever field it is put in', () => {
        const carriers: unknown[] = [
            MARKER,
            new Error(MARKER),
            { toString: () => MARKER, toJSON: () => MARKER },
            new String(MARKER),
            [MARKER]
        ];
        for (const event of Object.keys(allowlist.events) as TelemetryEvent[]) {
            for (const carrier of carriers) {
                const fields = Object.fromEntries(Object.keys(allowlist.fields).map(name => [name, carrier]));
                logEvent(event, fields as TelemetryFields);
                logEvent(event, { kind: errorKind(carrier) });
            }
        }
        expect(log.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0);
        expect(everything()).not.toContain(MARKER);
    });
});

describe('errorKind', () => {
    it('names the class and never the message', () => {
        expect(errorKind(new Error(`connect ECONNREFUSED postgres://omni:${MARKER}@db:5432`))).toBe('Error');
        expect(errorKind(new TypeError(MARKER))).toBe('TypeError');
        expect(errorKind(new SyntaxError(MARKER))).toBe('SyntaxError');
        expect(errorKind(new DOMException(MARKER, 'TimeoutError'))).toBe('TimeoutError');
        expect(errorKind(new DOMException(MARKER, 'AbortError'))).toBe('AbortError');
        expect(errorKind(new ProviderResponseError(MARKER, 429))).toBe('ProviderResponseError');
    });

    it('is "other" for anything off the list', () => {
        class CustomError extends Error {
            name = 'CustomError';
        }
        const throwing = { get name(): string { throw new Error(MARKER); } };
        for (const value of [new CustomError(MARKER), new RangeError(MARKER), { name: MARKER }, MARKER, undefined, null, 42, throwing]) {
            expect(errorKind(value)).toBe('other');
        }
    });
});

describe('telemetry/events.json', () => {
    it('is version 1 of the syberlabs_events allowlist', () => {
        expect(allowlist.version).toBe(1);
        expect(allowlist.dataset).toBe('syberlabs_events');
    });

    it('gives every event a plain name, an owner, a one-line decision, a level and defined fields', () => {
        for (const [event, spec] of Object.entries(allowlist.events)) {
            expect(event).toMatch(/^flyspace\.[a-z_]+\.[a-z_]+$/);
            expect(spec.owner).toBe('Mateo');
            expect(spec.decision.trim()).not.toBe('');
            expect(spec.decision).not.toMatch(/\n/);
            expect(['error', 'warn']).toContain(spec.level);
            expect(spec.fields.length).toBe(new Set(spec.fields).size);
            for (const field of spec.fields) expect(Object.keys(allowlist.fields)).toContain(field);
        }
    });

    it('defines every field as a closed list of strings or an integer range', () => {
        for (const spec of Object.values(allowlist.fields) as unknown[]) {
            if (Array.isArray(spec)) {
                expect(spec.length).toBeGreaterThan(0);
                expect(spec.every(value => typeof value === 'string' && value !== '')).toBe(true);
                expect(new Set(spec).size).toBe(spec.length);
            } else {
                const [min, max] = (spec as { integer: number[] }).integer;
                expect(Number.isInteger(min) && Number.isInteger(max) && min <= max).toBe(true);
            }
        }
    });

    it('names every source the server relays', () => {
        expect(allowlist.fields.provider).toEqual(expect.arrayContaining(['polymarket', ...PUBLIC_PROXY_IDS]));
    });
});

// ============================================
// Nothing on the server writes to the console except through logEvent, so
// nothing outside the allowlist can be written.
// ============================================

const ROOT = path.resolve(__dirname, '../../../..');
const SERVER_DIRS = ['src/app/api', 'src/core/services/server', 'src/core/db'];
const WRITER = 'src/core/services/server/telemetry.ts';
const CONSOLE_CALL = /\bconsole\.(?:log|info|warn|error|debug|trace)\(/;

function serverFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...serverFiles(full));
        else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
}

describe('server console output', () => {
    it('goes through logEvent and nowhere else', () => {
        const files = SERVER_DIRS.flatMap(dir => serverFiles(path.join(ROOT, dir)))
            .map(file => path.relative(ROOT, file).split(path.sep).join('/'));
        expect(files).toContain(WRITER);
        const offenders = files
            .filter(file => file !== WRITER)
            .filter(file => CONSOLE_CALL.test(readFileSync(path.join(ROOT, file), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
