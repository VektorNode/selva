/**
 * Stable hashing for solve deduplication and caching.
 * @internal
 */

import { isDefinitionRef, type SolveDefinition } from '../definition-ref';

/**
 * Deterministic stringify with sorted keys. {a:1,b:2} and {b:2,a:1} produce
 * the same string. Safely handles circular references and non-finite numbers.
 *
 * The output is a cache key, so the invariant that matters is: two payloads
 * that serialize differently on the wire must stringify differently here
 * (false misses are harmless; false hits serve the wrong cached solve).
 */
export function stableStringify(value: unknown): string {
	// Tracks the current recursion path only (entries are removed on the way
	// out), so genuine cycles read "[Circular]" while shared non-circular
	// references stringify by content each time they appear.
	const path = new WeakSet<object>();

	const stringify = (v: unknown): string => {
		if (v === undefined) return 'undefined';
		if (v === null) return 'null';
		if (typeof v === 'number') {
			return Number.isFinite(v) ? String(v) : 'null';
		}
		if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
		// Unquoted `n` suffix keeps 1n distinct from the string "1".
		if (typeof v === 'bigint') return `${v}n`;
		if (v instanceof Uint8Array) {
			// Full-content hash in one linear pass — sampling head/tail let two
			// buffers differing only in the middle share a cache key.
			return `{"__u8":${v.length},"hash":"${fnv1aBytes(v)}"}`;
		}
		if (Array.isArray(v)) {
			if (path.has(v)) return '"[Circular]"';
			path.add(v);
			const parts: string[] = [];
			// Indexed access (not .map) so holes stringify like undefined instead
			// of vanishing from the joined output.
			for (let i = 0; i < v.length; i++) parts.push(stringify(v[i]));
			path.delete(v);
			return `[${parts.join(',')}]`;
		}
		if (typeof v === 'object') {
			if (path.has(v)) return '"[Circular]"';
			path.add(v);
			let out: string;
			if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
				// Matches wire behavior: JSON.stringify calls toJSON (Date → ISO string).
				out = stringify((v as { toJSON: () => unknown }).toJSON());
			} else if (v instanceof Map) {
				const entries = [...v.entries()].map(([k, val]) => `[${stringify(k)},${stringify(val)}]`);
				out = `{"__map":[${entries.sort().join(',')}]}`;
			} else if (v instanceof Set) {
				const items = [...v.values()].map(stringify);
				out = `{"__set":[${items.sort().join(',')}]}`;
			} else {
				const keys = Object.keys(v as object).sort();
				const parts = keys.map(
					(k) => `${JSON.stringify(k)}:${stringify((v as Record<string, unknown>)[k])}`
				);
				out = `{${parts.join(',')}}`;
			}
			path.delete(v);
			return out;
		}
		// Fallback for functions, symbols, etc.
		return 'null';
	};

	return stringify(value);
}

/**
 * 32-bit FNV-1a core over a sequence of byte/char codes. Returns unsigned hex.
 * Shared by the string and byte hashers so they stay the same algorithm.
 */
function fnv1aCore(length: number, codeAt: (i: number) => number): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < length; i++) {
		hash ^= codeAt(i);
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/**
 * 32-bit FNV-1a— fast, no dependencies. Returns unsigned hex string.
 */
export function fnv1a(input: string): string {
	return fnv1aCore(input.length, (i) => input.charCodeAt(i));
}

/**
 * 32-bit FNV-1a over raw bytes. Returns unsigned hex string.
 */
export function fnv1aBytes(bytes: Uint8Array): string {
	return fnv1aCore(bytes.length, (i) => bytes[i]);
}

/**
 * Hash definition and data tree into a stable cache key.
 *
 * The definition is the *identity* of what we solve, so a binary definition is
 * hashed over its full content (`fnv1aBytes`) — a length-only or sampled key
 * would let two different `.gh` files collide and serve one's cached solve for
 * the other. `.gh` files are small enough that a single linear pass is
 * negligible. A {@link DefinitionRef} is keyed by its `key` alone — the
 * caller-declared identity of immutable bytes — so no bytes are materialized
 * or hashed at all.
 *
 * The key keeps the definition and tree hashes as separate parts rather than
 * collapsing them into one 32-bit hash: a single FNV pass over the pair would
 * birthday-collide quadratically in cache size, while requiring both 32-bit
 * parts (plus lengths) to collide at once makes that negligible.
 */
export function hashSolveInput(definition: SolveDefinition, dataTree: unknown): string {
	return hashSolveInputForDefinition(hashDefinition(definition), dataTree);
}

/**
 * Build the solve cache key from an already-computed definition hash (a
 * {@link hashDefinition} result) plus the data tree. Split out so a caller
 * that needs the definition hash anyway (the scheduler keys its
 * server-cache-key map by it) computes it once at `solve()` entry and threads
 * it through, instead of paying a second linear FNV pass over a potentially
 * multi-MB base64 definition per solve.
 *
 * Invariant: `hashSolveInputForDefinition(hashDefinition(d), t)` produces the
 * exact same key as `hashSolveInput(d, t)` — cache-key semantics are unchanged.
 */
export function hashSolveInputForDefinition(definitionHash: string, dataTree: unknown): string {
	const tree = stableStringify(dataTree);
	return `${definitionHash}|t:${tree.length}:${fnv1a(tree)}`;
}

/**
 * Stable identity of a definition alone (no inputs) — used to key the
 * server-cache-key map so the same definition reuses its `pointer` across solves
 * with different inputs. Same full-content hashing as {@link hashSolveInput}: a
 * binary definition is hashed over all its bytes so two distinct `.gh` files of
 * equal length can't share a cache key. A {@link DefinitionRef} is keyed by its
 * `key` verbatim (refs are short identities like UUIDs, safe as Map keys) —
 * its immutability contract makes the key equivalent to a content hash.
 */
export function hashDefinition(definition: SolveDefinition): string {
	if (isDefinitionRef(definition)) return `r:${definition.key}`;
	// Hash strings too (don't return the raw definition): a multi-MB base64 `.gh`
	// would otherwise become the literal Map key in serverCacheKeys / the cache.
	return typeof definition === 'string'
		? `s:${definition.length}:${fnv1a(definition)}`
		: `u8:${definition.length}:${fnv1aBytes(definition)}`;
}
