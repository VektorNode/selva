/** A definition identified by a stable key, with its bytes loaded only when an upload is unavoidable. */
export interface DefinitionRef {
	/**
	 * Identity of immutable bytes, such as a version UUID; never a mutable name or path. Every
	 * cache trusts the key without looking at the bytes, so two contents sharing a key are served
	 * each other's solves, with no diagnostic.
	 */
	key: string;
	/** Called when the solve runs, not when it is scheduled: a solve aborted while queued never loads. */
	load: () => Promise<Uint8Array>;
}

/**
 * A URL is sent as a pointer, a string is uploaded as base64 (or encoded text), bytes are
 * uploaded as-is. Strings and bytes are content-hashed for caching; a `DefinitionRef` is keyed
 * by its `key`.
 */
export type SolveDefinition = string | Uint8Array | DefinitionRef;

export function isDefinitionRef(definition: SolveDefinition): definition is DefinitionRef {
	return (
		typeof definition === 'object' &&
		!(definition instanceof Uint8Array) &&
		typeof definition.key === 'string' &&
		typeof definition.load === 'function'
	);
}

/** A URL is already a server-side reference: it is never uploaded or keyed by server cache key. */
export function isDefinitionUrl(definition: SolveDefinition): definition is string {
	return typeof definition === 'string' && /^https?:\/\//i.test(definition);
}
