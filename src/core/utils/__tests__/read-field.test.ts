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

	// Issue 91: the exact-match path used `name in record`, which walks the
	// prototype chain — probing a payload for an Object.prototype-named field
	// returned a function instead of undefined.
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

	// Issue 106: the lowered-key cache was built on first read and never
	// refreshed, so keys added afterwards were invisible to cased lookups.
	it('sees keys added after the first read (cache staleness)', () => {
		const payload: Record<string, unknown> = { First: 1 };
		expect(readField(payload, 'first')).toBe(1); // primes the cache
		payload.Second = 2;
		expect(readField(payload, 'second')).toBe(2); // cased lookup, post-mutation
		expect(hasField(payload, 'SECOND')).toBe(true);
	});

	it('still serves repeated cased reads of an unmutated object', () => {
		const payload = { InnerTree: 1, ParamName: 'x' };
		expect(readField(payload, 'innertree')).toBe(1);
		expect(readField(payload, 'paramname')).toBe('x');
		expect(readField(payload, 'innerTree')).toBe(1);
	});
});

describe('hasField', () => {
	it('detects a key regardless of casing', () => {
		expect(hasField({ InnerTree: {} }, 'innerTree')).toBe(true);
		expect(hasField({ innerTree: {} }, 'InnerTree')).toBe(true);
	});

	it('is true even when the value is null/undefined', () => {
		expect(hasField({ x: null }, 'x')).toBe(true);
		expect(hasField({ x: undefined }, 'x')).toBe(true);
	});

	it('is false when the key is absent or input is not an object', () => {
		expect(hasField({ a: 1 }, 'b')).toBe(false);
		expect(hasField(null, 'x')).toBe(false);
	});

	// Issue 91: `hasField({}, 'constructor')` returned true via the prototype chain.
	it('is false for inherited prototype keys', () => {
		expect(hasField({}, 'constructor')).toBe(false);
		expect(hasField({}, 'toString')).toBe(false);
	});
});
