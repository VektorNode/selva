import { describe, it, expect } from 'vitest';
import {
	hashSolveInput,
	hashSolveInputForDefinition,
	hashDefinition,
	stableStringify
} from '../stable-hash';
import { TreeBuilder } from '../../data-tree/data-tree';

// Computed independently with node:crypto over the UTF-16LE canonical strings.
const PINNED_TREE_HASH = '0dc0064221f3ee95e77a4985e677d7ef18c74fa78c295d3834b595546c741271';
const PINNED_STRING_KEY = `s:0a5b3df5c641fd2413225d667e94b27c0d984348abc424553efb52bcb4fe7be7|t:${PINNED_TREE_HASH}`;
const PINNED_BYTES_KEY = `u8:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81|t:${PINNED_TREE_HASH}`;

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

	// Their wire payloads differ ([null] vs []), so their keys must too.
	it('distinguishes [undefined] from [] and always returns a string', () => {
		expect(stableStringify([undefined])).not.toBe(stableStringify([]));
		expect(typeof stableStringify(undefined)).toBe('string');
	});

	it('distinguishes sparse arrays from empty arrays', () => {
		expect(stableStringify(new Array(1))).not.toBe(stableStringify([]));
	});

	// The circular guard must un-mark a finished subtree, or a reference seen twice reads as
	// "[Circular]" the second time.
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

	// Date/Map/Set have no own keys: walked as plain objects, every one stringifies as {}.
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

	it('distinguishes bigint from the equivalent string', () => {
		expect(stableStringify(1n)).not.toBe(stableStringify('1'));
	});

	it('distinguishes large Uint8Arrays differing only in the middle', () => {
		const a = new Uint8Array(128).fill(7);
		const b = new Uint8Array(128).fill(7);
		b[64] = 8;
		expect(stableStringify(a)).not.toBe(stableStringify(b));
	});
});

describe('stableStringify markers', () => {
	// A JSON body can carry any plain object, so none may stringify like a non-JSON value.
	it('keeps non-JSON values apart from plain objects shaped like their markers', () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const marker = stableStringify(bytes);
		expect(stableStringify(JSON.parse(JSON.stringify({ __u8: 3, hash: 'x' })))).not.toBe(marker);
		expect(stableStringify(new Map([['a', 1]]))).not.toBe(stableStringify({ __map: [['a', 1]] }));
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(stableStringify(cyclic)).not.toBe(stableStringify({ self: '[Circular]' }));
	});

	// JSON drops a function-valued key, so `{ a: fn }` goes over the wire as `{}`, not `{ a: null }`.
	it('stringifies a function like undefined, not like null', () => {
		expect(stableStringify({ a: () => 1 })).toBe(stableStringify({ a: undefined }));
		expect(stableStringify({ a: () => 1 })).not.toBe(stableStringify({ a: null }));
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

	// A collision serves one definition's solve for the other.
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

	it('does not collide for tree Uint8Arrays differing only in the middle', () => {
		const a = new Uint8Array(128).fill(7);
		const b = new Uint8Array(128).fill(7);
		b[64] = 8;
		expect(hashSolveInput('def.gh', [a])).not.toBe(hashSolveInput('def.gh', [b]));
	});

	it('keeps definition and tree hashes as separate SHA-256 key parts', () => {
		expect(hashSolveInput('def.gh', tree)).toMatch(/^s:[0-9a-f]{64}\|t:[0-9a-f]{64}$/);
		expect(hashSolveInput({ key: 'v1', load: async () => new Uint8Array() }, tree)).toMatch(
			/^r:v1\|t:[0-9a-f]{64}$/
		);
	});

	// A durable cache keyed by hashSolveInput misses every entry if these move.
	it('matches pinned keys', () => {
		expect(hashSolveInput('def.gh', tree)).toBe(PINNED_STRING_KEY);
		expect(hashSolveInput(new Uint8Array([1, 2, 3]), tree)).toBe(PINNED_BYTES_KEY);
	});

	// The scheduler's cache serves every user of a server: a forged collision would let one user
	// choose what another's solve returns.
	it('separates a pair forged to collide under 32-bit FNV-1a', () => {
		const labelled = (label: string) =>
			TreeBuilder.fromValues([
				{ paramName: 'Label', paramType: 'Text', value: label },
				{ paramName: 'Width', paramType: 'Number', value: 12.5, minimum: 0, maximum: 100 }
			]);
		expect(hashSolveInput('def.gh', labelled('Hello, Selva!'))).not.toBe(
			hashSolveInput('def.gh', labelled('pwned__W3jEwn'))
		);
	});

	it('hashSolveInputForDefinition(hashDefinition(d), t) equals hashSolveInput(d, t)', () => {
		const binary = new Uint8Array([1, 2, 3, 4]);
		for (const def of ['def.gh', binary] as const) {
			expect(hashSolveInputForDefinition(hashDefinition(def), tree)).toBe(
				hashSolveInput(def, tree)
			);
		}
	});
});
