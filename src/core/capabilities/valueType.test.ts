import { describe, it, expect } from 'vitest';
import { isAssignable, validateValue, validateValueType, type ValueType } from './valueType';

// Names every plain object inherits. A schema lookup or a presence check
// must not be satisfied by one of them.
describe('schema and value lookups read own properties only', () => {
    it('a required property is missing even when Object.prototype has that name', () => {
        const schema: ValueType = { kind: 'object', properties: { toString: { kind: 'string' as const } }, required: ['toString'] };
        expect(validateValue(schema, {})).toEqual(['value.toString is required']);
        expect(validateValue(schema, { toString: 'set' })).toEqual([]);
    });

    it('an undeclared key is not validated against an inherited schema', () => {
        const closed: ValueType = { kind: 'object', properties: { a: { kind: 'string' } }, additionalProperties: false };
        expect(validateValue(closed, { a: 'x', hasOwnProperty: 1 })).toEqual(['value.hasOwnProperty is not a declared property']);
        const open: ValueType = { kind: 'object', properties: { a: { kind: 'string' } } };
        expect(validateValue(open, { a: 'x', valueOf: 'data' })).toEqual([]);
    });

    it('a schema cannot require a property it only inherits', () => {
        const errors = validateValueType({ kind: 'object', properties: { a: { kind: 'string' } }, required: ['toString'] });
        expect(errors).toContain('schema.required names missing property toString');
    });

    it('assignability does not read a target property through inheritance', () => {
        const source: ValueType = { kind: 'object', properties: { toString: { kind: 'string' as const } } };
        expect(isAssignable(source, { kind: 'object' })).toBe(true);
        expect(isAssignable(source, { kind: 'object', additionalProperties: { kind: 'number' } })).toBe(false);
        const requires: ValueType = { kind: 'object', properties: {}, required: ['constructor'] };
        expect(isAssignable({ kind: 'object', properties: {}, required: ['constructor'] }, requires)).toBe(false);
    });
});
