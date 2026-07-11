/**
 * By-reference definition form for solves.
 *
 * Lets a caller that already knows a definition's identity (e.g. a stored
 * version's UUID) schedule solves without materializing the multi-MB bytes:
 * cache keys and the server-pointer map are derived from `key` alone, and
 * `load()` is only called when an upload is genuinely unavoidable (first solve
 * of a definition, or a server-side pointer miss).
 */

/**
 * A definition identified by a stable key, with bytes materialized on demand.
 *
 * **Immutability contract — read this before constructing one.** `key` must
 * identify IMMUTABLE bytes: every `load()` for a given `key` must return the
 * same content, forever. All caching (the scheduler's result cache, the
 * server-pointer map, and any durable cache built on these keys) trusts the
 * key as the definition's identity WITHOUT looking at the bytes. If two
 * different byte contents ever share a key, cached solves from one are served
 * for the other — silent cache poisoning with no diagnostic. Use an identity
 * that can never be reused for different content (e.g. a version UUID), never
 * a mutable name or path.
 */
export interface DefinitionRef {
	/**
	 * Identity of immutable bytes (e.g. a version UUID). Two different byte
	 * contents must never share a key — cache poisoning otherwise.
	 */
	key: string;
	/**
	 * Materialize the bytes. Called ONLY when an upload is unavoidable — inside
	 * the solve execution, so it counts toward the solve's abort semantics.
	 */
	load: () => Promise<Uint8Array>;
}

/**
 * Every definition form accepted by the solve entry points:
 * - a URL, base64 string, or plain string (content-hashed for caching)
 * - raw `.gh` bytes (content-hashed)
 * - a {@link DefinitionRef} (identity-keyed; bytes loaded lazily)
 */
export type SolveDefinition = string | Uint8Array | DefinitionRef;

/** Narrow a {@link SolveDefinition} to the by-reference form. */
export function isDefinitionRef(definition: SolveDefinition): definition is DefinitionRef {
	return (
		typeof definition === 'object' &&
		!(definition instanceof Uint8Array) &&
		typeof definition.key === 'string' &&
		typeof definition.load === 'function'
	);
}
