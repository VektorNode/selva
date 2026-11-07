import type { RequestContext } from '../context.js';

/**
 * Server-side resolver for inputs marked `source: { kind: 'server', key }` in the schema.
 * No solve path calls one: a `server`-kind input solves with its schema default, and the
 * solve path refuses a value a caller posts for it.
 *
 * Keys are opaque strings namespaced by the host (e.g. 'capture.geometry',
 * 'parcel.boundary') and interpreted however it likes — typically as an
 * address into the host's own domain store.
 */
export interface IBindingResolver {
	/**
	 * Resolves a batch of bound keys in one call.
	 *
	 * `keys` is what the schema author wrote (`source.key`) — describes WHAT
	 * attribute to read, not WHICH entity. `scope` is set by the calling
	 * route at solve time and supplies the "which entity" anchor that varies
	 * per request (capture id, parcel id, custom struct); optional because
	 * not every host needs it.
	 *
	 * Return only the keys that resolved: an absent entry means missing. Throw
	 * only for resolver-wide failures (DB unreachable, configuration error); a
	 * missing individual key is not an error condition.
	 *
	 * Batched because a single solve often binds multiple inputs from one
	 * domain object, and the resolver should do that in one DB round-trip.
	 */
	resolve(
		ctx: RequestContext,
		keys: readonly string[],
		scope?: unknown
	): Promise<Map<string, unknown>>;
}

/** Resolves nothing. */
export class NoopBindingResolver implements IBindingResolver {
	async resolve(): Promise<Map<string, unknown>> {
		return new Map();
	}
}
