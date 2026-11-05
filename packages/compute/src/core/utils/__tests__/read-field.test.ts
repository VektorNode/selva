import { describe, expect, it } from 'vitest';
import { readField, hasField } from '@/core/utils/read-field';

describe('readField', () => {
	it('reads an exact-case key', () => {
		expect(readField({ InnerTree: 1 }, 'InnerTree')).toBe(1);
	});

	it('reads a differently-cased key', () => {
		expect(readField({ InnerTree: 1 }, 'innerTree')).toBe(1);
		expect(readField({ innertree: 1 }, 'InnerTree')).toBe(1);
	});

	it('prefers the exact-case match when both are present', () => {
		// Defensive: if a payload somehow carried both, exact wins.
		expect(readField({ innerTree: 'lower', InnerTree: 'pascal' }, 'innerTree')).toBe('lower');
	});

	it('returns undefined when no key matches', () => {
		expect(readField({ a: 1 }, 'b')).toBeUndefined();
	});

	it('returns undefined for non-object inputs', () => {
		expect(readField(null, 'x')).toBeUndefined();
		expect(readField(undefined, 'x')).toBeUndefined();
		expect(readField('str', 'x')).toBeUndefined();
		expect(readField(42, 'x')).toBeUndefined();
	});

	it('preserves a present-but-null value (distinct from absent)', () => {
		expect(readField({ x: null }, 'x')).toBeNull();
	});

	it('does not read inherited prototype keys', () => {
		expect(readField({}, 'toString')).toBeUndefined();
		expect(readField({}, 'constructor')).toBeUndefined();
		expect(readField({}, 'hasOwnProperty')).toBeUndefined();
		expect(readField({ a: 1 }, 'ToString')).toBeUndefined();
	});

	it('reads an OWN key that shadows a prototype name', () => {
		expect(readField({ toString: 'own' }, 'toString')).toBe('own');
		expect(readField({ toString: 'own' }, 'ToString')).toBe('own');
	});
});

describe('hasField', () => {
	it.each([
		['a key in another casing', { InnerTree: {} }, 'innerTree', true],
		['a null value', { x: null }, 'x', true],
		['an undefined value', { x: undefined }, 'x', true],
		['an absent key', { a: 1 }, 'b', false],
		['a non-object', null, 'x', false],
		['an inherited key', {}, 'constructor', false]
	])('handles %s', (_name, payload, key, expected) => {
		expect(hasField(payload, key)).toBe(expected);
	});
});
