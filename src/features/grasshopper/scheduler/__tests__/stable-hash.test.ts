import { describe, it, expect } from 'vitest';
import { hashSolveInput, stableStringify, fnv1a, fnv1aBytes } from '../stable-hash';

describe('stableStringify', () => {
	it('is key-order independent for objects', () => {
		expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
	});

	it('distinguishes different values', () => {
		expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
	});

	it('handles circular references without throwing', () => {
		const obj: { a: number; self?: unknown } = { a: 1 };
		obj.self = obj;
		expect(() => stableStringify(obj)).not.toThrow();
	});

	it('normalizes non-finite numbers to null', () => {
		expect(stableStringify(NaN)).toBe(stableStringify(null));
		expect(stableStringify(Infinity)).toBe(stableStringify(null));
	});

	// Regression: stringify(undefined) previously returned the *value* undefined,
	// which Array.prototype.join turned into an empty string — [undefined] and []
	// collided while their wire payloads differ ([null] vs []).
	it('distinguishes [undefined] from [] and always returns a string', () => {
		expect(stableStringify([undefined])).not.toBe(stableStringify([]));
		expect(typeof stableStringify(undefined)).toBe('string');
	});

	it('distinguishes sparse arrays from empty arrays', () => {
		expect(stableStringify(new Array(1))).not.toBe(stableStringify([]));
	});

	// Regression: the circular guard never un-marked finished subtrees, so a
	// shared (non-circular) reference stringified as "[Circular]" on its second
	// occurrence — [a, a] hashed differently from [{x:1},{x:1}].
	it('stringifies shared non-circular references by content', () => {
		const a = { x: 1 };
		expect(stableStringify([a, a])).toBe(stableStringify([{ x: 1 }, { x: 1 }]));
		expect(stableStringify([a, a])).not.toContain('[Circular]');
	});

	it('still guards genuine cycles, including circular arrays', () => {
		const obj: { a: number; self?: unknown } = { a: 1 };
		obj.self = obj;
		expect(stableStringify(obj)).toContain('[Circular]');
		const arr: unknown[] = [];
		arr.push(arr);
		expect(() => stableStringify(arr)).not.toThrow();
	});

	// Regression: Date/Map/Set fell into the generic Object.keys branch and all
	// stringified as {} — every Date collided with every other Date and with {}.
	it('honors toJSON so Dates stringify to their ISO strings', () => {
		const a = new Date('2026-01-01T00:00:00Z');
		const b = new Date('2026-06-15T12:00:00Z');
		expect(stableStringify(a)).not.toBe(stableStringify(b));
		expect(stableStringify(a)).not.toBe(stableStringify({}));
		expect(stableStringify(a)).toContain('2026-01-01');
	});

	it('distinguishes Maps and Sets by content, order-independently', () => {
		expect(stableStringify(new Map([['a', 1]]))).not.toBe(stableStringify(new Map([['a', 2]])));
		expect(stableStringify(new Map([['a', 1]]))).not.toBe(stableStringify({}));
		expect(
			stableStringify(
				new Map<string, number>([
					['a', 1],
					['b', 2]
				])
			)
		).toBe(
			stableStringify(
				new Map<string, number>([
					['b', 2],
					['a', 1]
				])
			)
		);
		expect(stableStringify(new Set([1, 2]))).toBe(stableStringify(new Set([2, 1])));
		expect(stableStringify(new Set([1]))).not.toBe(stableStringify(new Set([2])));
	});

	// Regression: bigint stringified identically to the equivalent string ("1").
	it('distinguishes bigint from the equivalent string', () => {
		expect(stableStringify(1n)).not.toBe(stableStringify('1'));
	});

	// Regression: Uint8Arrays > 64 bytes were keyed by length + head/tail sample,
	// so two buffers differing only in the middle shared a cache key.
	it('distinguishes large Uint8Arrays differing only in the middle', () => {
		const a = new Uint8Array(128).fill(7);
		const b = new Uint8Array(128).fill(7);
		b[64] = 8;
		expect(stableStringify(a)).not.toBe(stableStringify(b));
	});
});

describe('fnv1a / fnv1aBytes', () => {
	it('returns an 8-char hex string', () => {
		expect(fnv1a('hello')).toMatch(/^[0-9a-f]{8}$/);
		expect(fnv1aBytes(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{8}$/);
	});

	it('agrees with fnv1a when bytes are ASCII char codes', () => {
		// fnv1aBytes over the char codes of "abc" must equal fnv1a("abc").
		const bytes = new Uint8Array([...'abc'].map((c) => c.charCodeAt(0)));
		expect(fnv1aBytes(bytes)).toBe(fnv1a('abc'));
	});

	it('distinguishes different byte content', () => {
		expect(fnv1aBytes(new Uint8Array([1, 2, 3]))).not.toBe(fnv1aBytes(new Uint8Array([3, 2, 1])));
	});
});

describe('hashSolveInput', () => {
	const tree = [{ ParamName: 'x', InnerTree: {} }];

	it('is stable for identical inputs', () => {
		expect(hashSolveInput('def.gh', tree)).toBe(hashSolveInput('def.gh', tree));
	});

	it('changes when the definition changes', () => {
		expect(hashSolveInput('a.gh', tree)).not.toBe(hashSolveInput('b.gh', tree));
	});

	it('changes when the data tree changes', () => {
		const other = [{ ParamName: 'y', InnerTree: {} }];
		expect(hashSolveInput('def.gh', tree)).not.toBe(hashSolveInput('def.gh', other));
	});

	// Regression: a binary definition was previously keyed on length alone, so two
	// different files of equal length produced the same cache key and one's solve
	// was served for the other.
	it('does not collide for different binary definitions of equal length', () => {
		const a = new Uint8Array([1, 2, 3, 4]);
		const b = new Uint8Array([4, 3, 2, 1]);
		expect(a.length).toBe(b.length);
		expect(hashSolveInput(a, tree)).not.toBe(hashSolveInput(b, tree));
	});

	it('does not collide for binary definitions sharing endpoints but differing in the middle', () => {
		// Same first-32 and last-32 bytes + same length — would collide under a
		// sampled key, but full-content hashing separates them.
		const head = new Uint8Array(32).fill(7);
		const tail = new Uint8Array(32).fill(9);
		const a = new Uint8Array([...head, ...new Uint8Array(64).fill(1), ...tail]);
		const b = new Uint8Array([...head, ...new Uint8Array(64).fill(2), ...tail]);
		expect(a.length).toBe(b.length);
		expect(hashSolveInput(a, tree)).not.toBe(hashSolveInput(b, tree));
	});

	// Regression: the tree path sampled Uint8Arrays (head/tail only), so two
	// solves differing only mid-buffer inside the dataTree shared a cache key.
	it('does not collide for tree Uint8Arrays differing only in the middle', () => {
		const a = new Uint8Array(128).fill(7);
		const b = new Uint8Array(128).fill(7);
		b[64] = 8;
		expect(hashSolveInput('def.gh', [a])).not.toBe(hashSolveInput('def.gh', [b]));
	});

	// Regression: the final key was one 32-bit FNV pass over the (definition, tree)
	// pair — birthday-collidable. Keeping the parts separate means a collision
	// requires both 32-bit hashes (and lengths) to collide simultaneously.
	it('keeps definition and tree hashes as separate key parts', () => {
		const key = hashSolveInput('def.gh', tree);
		expect(key).toMatch(/^s:\d+:[0-9a-f]{8}\|t:\d+:[0-9a-f]{8}$/);
	});
});
