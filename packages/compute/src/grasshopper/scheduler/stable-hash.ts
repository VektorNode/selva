/**
 * Solve-key hashing, public so an app-layer durable cache or a pre-solved bundle viewer can
 * reproduce the scheduler's exact key. A key that canonicalizes even slightly differently
 * misses every entry the scheduler wrote, or worse, collides differently.
 *
 * Keys are SHA-256: one scheduler's cache serves every user of a server, so a key a user can
 * collide on purpose lets them choose what another user's solve returns.
 */

import { isDefinitionRef, type SolveDefinition } from '@/core/definition-ref';
import { sha256Hex } from '@/core/utils/sha256';

/**
 * Deterministic stringify with sorted keys. {a:1,b:2} and {b:2,a:1} produce
 * the same string. Safely handles circular references and non-finite numbers.
 *
 * The output is a cache key, so the invariant that matters is: two payloads
 * that serialize differently on the wire must stringify differently here
 * (false misses are harmless; false hits serve the wrong cached solve).
 * Non-JSON values get unquoted markers (`{u8:…}`, `[Circular]`) that no JSON
 * value stringifies to, so a plain object can't pose as one.
 */
export function stableStringify(value: unknown): string {
	// Tracks the current recursion path only (entries are removed on the way
	// out), so genuine cycles read "[Circular]" while shared non-circular
	// references stringify by content each time they appear.
	const path = new WeakSet<object>();

	const stringify = (v: unknown): string => {
		if (v === null) return 'null';
		if (typeof v === 'number') {
			return Number.isFinite(v) ? String(v) : 'null';
		}
		if (typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
		// Unquoted `n` suffix keeps 1n distinct from the string "1".
		if (typeof v === 'bigint') return `${v}n`;
		// JSON drops a function or symbol exactly like `undefined`, so they share its marker.
		if (typeof v !== 'object') return 'undefined';
		if (v instanceof Uint8Array) return `{u8:${sha256Hex(v)}}`;
		if (path.has(v)) return '[Circular]';
		path.add(v);
		let out: string;
		if (Array.isArray(v)) {
			const parts: string[] = [];
			// Indexed access (not .map) so holes stringify like undefined instead
			// of vanishing from the joined output.
			for (let i = 0; i < v.length; i++) parts.push(stringify(v[i]));
			out = `[${parts.join(',')}]`;
		} else if (typeof (v as { toJSON?: unknown }).toJSON === 'function') {
			// Matches wire behavior: JSON.stringify calls toJSON (Date → ISO string).
			out = stringify((v as { toJSON: () => unknown }).toJSON());
		} else if (v instanceof Map) {
			const entries = [...v.entries()].map(([k, val]) => `[${stringify(k)},${stringify(val)}]`);
			out = `{map:[${entries.sort().join(',')}]}`;
		} else if (v instanceof Set) {
			const items = [...v.values()].map(stringify);
			out = `{set:[${items.sort().join(',')}]}`;
		} else {
			const keys = Object.keys(v).sort();
			const parts = keys.map(
				(k) => `${JSON.stringify(k)}:${stringify((v as Record<string, unknown>)[k])}`
			);
			out = `{${parts.join(',')}}`;
		}
		path.delete(v);
		return out;
	};

	return stringify(value);
}

/** The scheduler's solve-cache key for a definition and its input tree. */
export function hashSolveInput(definition: SolveDefinition, dataTree: unknown): string {
	return hashSolveInputForDefinition(hashDefinition(definition), dataTree);
}

/**
 * `hashSolveInput` from a precomputed {@link hashDefinition}, so the scheduler, which also keys its
 * server-cache-key map by that hash, passes over a multi-MB definition once per solve.
 *
 * @internal
 */
export function hashSolveInputForDefinition(definitionHash: string, dataTree: unknown): string {
	return `${definitionHash}|t:${sha256Hex(stableStringify(dataTree))}`;
}

/**
 * A definition's identity, without its inputs. Strings and bytes are hashed over their full
 * content; a `DefinitionRef` uses its `key`.
 */
export function hashDefinition(definition: SolveDefinition): string {
	if (isDefinitionRef(definition)) return `r:${definition.key}`;
	return typeof definition === 'string'
		? `s:${sha256Hex(definition)}`
		: `u8:${sha256Hex(definition)}`;
}
