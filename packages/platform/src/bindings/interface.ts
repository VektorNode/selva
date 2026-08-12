/**
 * Server-side resolver for inputs marked as `source: { kind: 'server', key }`
 * in the schema. The host (selva app or a fork) supplies an implementation;
 * the platform stays domain-agnostic.
 *
 * Keys are opaque strings namespaced by the host (e.g. 'capture.geometry',
 * 'parcel.boundary') and interpreted however it likes — typically as an
 * address into the host's own domain store.
 */

import type { RequestContext } from '../context.js';

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
	 * Return only the keys that resolved successfully — an absent entry
	 * signals "missing" to the caller, which then errors the solve or falls
	 * back to the input's `default`. Throw only for resolver-wide failures
	 * (DB unreachable, configuration error); a missing individual key is not
	 * an error condition.
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

/**
 * Default resolver for when the host hasn't configured one. Returns an
 * empty map for any request, so every bound input fails at solve time —
 * a loud signal that a resolver needs wiring up.
 */
export class NoopBindingResolver implements IBindingResolver {
	async resolve(): Promise<Map<string, unknown>> {
		return new Map();
	}
}
