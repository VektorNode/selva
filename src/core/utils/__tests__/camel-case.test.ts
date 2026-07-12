/**
 * Suite for `toCamelCase` / `camelcaseKeys` (issues 93 and 109 — previously
 * untested entirely).
 *
 * - toCamelCase: leading separators are stripped, leading acronym runs are
 *   lowercased as a unit, `__proto__`-shaped keys can never survive as
 *   `__proto__` (proto pollution stays impossible).
 * - camelcaseKeys deep mode: non-plain objects (Date, Map, Set, typed arrays,
 *   class instances) pass through untouched; colliding keys warn and resolve
 *   last-wins.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toCamelCase, camelcaseKeys } from '../camel-case';
import { setLogger } from '../logger';

afterEach(() => {
	setLogger(null);
});

describe('toCamelCase', () => {
	it('converts snake_case, kebab-case, and spaced words', () => {
		expect(toCamelCase('inner_tree')).toBe('innerTree');
		expect(toCamelCase('param-name')).toBe('paramName');
		expect(toCamelCase('model units')).toBe('modelUnits');
		expect(toCamelCase('Already Pascal Case')).toBe('alreadyPascalCase');
	});

	it('lowercases the first character of PascalCase words', () => {
		expect(toCamelCase('InnerTree')).toBe('innerTree');
		expect(toCamelCase('Simple')).toBe('simple');
	});

	it('preserves spaces when preserveSpaces is set', () => {
		expect(toCamelCase('Value List Label', { preserveSpaces: true })).toBe('value List Label');
		expect(toCamelCase('with_underscore and space', { preserveSpaces: true })).toBe(
			'withUnderscore and space'
		);
	});

	// Issue 109: acronyms — previously 'URLPath' → 'uRLPath', 'IDNumber' → 'iDNumber'.
	it('lowercases a leading acronym run as a unit', () => {
		expect(toCamelCase('URLPath')).toBe('urlPath');
		expect(toCamelCase('IDNumber')).toBe('idNumber');
		expect(toCamelCase('URL')).toBe('url');
		expect(toCamelCase('ID')).toBe('id');
		expect(toCamelCase('ID9')).toBe('id9');
	});

	// Issue 109: leading separators — previously '_foo' → '_foo'.
	it('strips leading and trailing separators', () => {
		expect(toCamelCase('_foo')).toBe('foo');
		expect(toCamelCase('__foo_bar__')).toBe('fooBar');
		expect(toCamelCase('-leading-dash')).toBe('leadingDash');
	});

	it('can never emit __proto__ (or any separator character)', () => {
		expect(toCamelCase('__proto__')).toBe('proto');
		expect(toCamelCase('__proto__')).not.toContain('_');
		expect(toCamelCase('__proto__', { preserveSpaces: true })).toBe('proto');
	});

	it('handles empty and single-character inputs', () => {
		expect(toCamelCase('')).toBe('');
		expect(toCamelCase('a')).toBe('a');
		expect(toCamelCase('A')).toBe('a');
	});
});

describe('camelcaseKeys', () => {
	it('camelCases top-level keys (shallow by default)', () => {
		const result = camelcaseKeys({ Param_Name: 1, Inner_Tree: { Deep_Key: 2 } }) as Record<
			string,
			any
		>;
		expect(result.paramName).toBe(1);
		expect(result.innerTree).toEqual({ Deep_Key: 2 }); // untouched when not deep
	});

	it('camelCases nested keys and array elements when deep', () => {
		const result = camelcaseKeys(
			{ Outer_Key: [{ Inner_Key: 1 }], Plain: { Nested_Key: 2 } },
			{ deep: true }
		) as Record<string, any>;
		expect(result.outerKey[0].innerKey).toBe(1);
		expect(result.plain.nestedKey).toBe(2);
	});

	it('passes primitives and null through', () => {
		expect(camelcaseKeys(null)).toBeNull();
		expect(camelcaseKeys(42)).toBe(42);
		expect(camelcaseKeys('str')).toBe('str');
	});

	// Issue 93: deep mode reduced any non-plain object via Object.keys — Date
	// became {}, Uint8Array became {0: …, 1: …}.
	it('passes non-plain objects through untouched in deep mode', () => {
		const date = new Date('2026-01-01T00:00:00Z');
		const bytes = new Uint8Array([1, 2, 3]);
		const map = new Map([['K', 1]]);
		const set = new Set([1]);
		class Thing {
			Some_Field = 1;
		}
		const thing = new Thing();

		const result = camelcaseKeys(
			{ A_Date: date, Raw_Bytes: bytes, A_Map: map, A_Set: set, A_Thing: thing },
			{ deep: true }
		) as Record<string, any>;

		expect(result.aDate).toBe(date); // same reference, not {}
		expect(result.rawBytes).toBe(bytes);
		expect(result.aMap).toBe(map);
		expect(result.aSet).toBe(set);
		expect(result.aThing).toBe(thing);
	});

	it('traverses null-prototype objects (still plain data)', () => {
		const bare = Object.create(null) as Record<string, unknown>;
		bare.Some_Key = 1;
		const result = camelcaseKeys(bare, { deep: true }) as Record<string, any>;
		expect(result.someKey).toBe(1);
	});

	// Issue 93: colliding keys silently overwrote last-wins with no warning.
	it('warns on colliding keys and keeps the LAST one (documented last-wins)', () => {
		const warn = vi.fn();
		setLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });

		const result = camelcaseKeys({ inner_tree: 'first', innerTree: 'second' }) as Record<
			string,
			any
		>;

		expect(result.innerTree).toBe('second');
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toContain('innerTree');
	});

	it('does not false-warn when a camelCased key matches an Object.prototype name', () => {
		const warn = vi.fn();
		setLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() });

		const result = camelcaseKeys({ to_string: 1, value_of: 2 }) as Record<string, any>;

		expect(result.toString).toBe(1);
		expect(result.valueOf).toBe(2);
		expect(warn).not.toHaveBeenCalled();
	});

	it('cannot pollute Object.prototype via a __proto__ key', () => {
		const result = camelcaseKeys({ ['__proto__']: { polluted: true } }) as Record<string, any>;
		expect(({} as any).polluted).toBeUndefined();
		expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
		expect(result.proto).toEqual({ polluted: true }); // lands as a normal own key
	});
});
