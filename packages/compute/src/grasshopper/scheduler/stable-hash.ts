/**
 * Solve-key hashing, public so an app-layer durable cache or a pre-solved bundle viewer can
 * reproduce the scheduler's exact key. A key that canonicalizes even slightly differently
 * misses every entry the scheduler wrote, or worse, collides differently.
 */

import { isDefinitionRef, type SolveDefinition } from '@/core/definition-ref';

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

/** 32-bit FNV-1a, as 8 hex chars. */
function fnv1aCore(length: number, codeAt: (i: number) => number): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < length; i++) {
		hash ^= codeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/** @internal */
export function fnv1a(input: string): string {
	return fnv1aCore(input.length, (i) => input.charCodeAt(i));
}

/** @internal */
export function fnv1aBytes(bytes: Uint8Array): string {
	return fnv1aCore(bytes.length, (i) => bytes[i]);
}

/** The scheduler's solve-cache key for a definition and its input tree. */
export function hashSolveInput(definition: SolveDefinition, dataTree: unknown): string {
	return hashSolveInputForDefinition(hashDefinition(definition), dataTree);
}

/**
 * `hashSolveInput` from a precomputed {@link hashDefinition}, so the scheduler, which also keys its
 * server-cache-key map by that hash, passes over a multi-MB definition once per solve.
 *
 * The definition and tree hashes stay separate key parts: one 32-bit hash over the pair would
 * birthday-collide as the cache grows, while two must collide at once here.
 *
 * @internal
 */
export function hashSolveInputForDefinition(definitionHash: string, dataTree: unknown): string {
	const tree = stableStringify(dataTree);
	return `${definitionHash}|t:${tree.length}:${fnv1a(tree)}`;
}

/**
 * A definition's identity, without its inputs. Strings and bytes are hashed over their full
 * content, so two files of equal length never share a key; a `DefinitionRef` uses its `key`.
 */
export function hashDefinition(definition: SolveDefinition): string {
	if (isDefinitionRef(definition)) return `r:${definition.key}`;
	return typeof definition === 'string'
		? `s:${definition.length}:${fnv1a(definition)}`
		: `u8:${definition.length}:${fnv1aBytes(definition)}`;
}
