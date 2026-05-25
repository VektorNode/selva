/**
 * Server-side resolver for inputs marked as `source: { kind: 'bound', path }`
 * in the schema. The host (selva app or a fork) supplies an implementation;
 * the platform stays domain-agnostic.
 *
 * Paths are opaque strings. The host defines the namespace
 * (e.g. 'segment.outline', 'parcel.boundary') and the resolver interprets it
 * however it likes — typically as a key into the host's own domain store.
 *
 * Status: preliminary. The interface is expected to refine once we wire a
 * real binding end-to-end (see docs/upstream-binding-prep PR plan). Current
 * shape is the minimum needed to slot a host implementation behind
 * `SelvaConfig.bindingResolver`.
 */

import type { RequestContext } from '../context.js';

export interface IBindingResolver {
	/**
	 * Resolve a batch of bound paths in one call.
	 *
	 *   - `paths` is what the schema author wrote — opaque to the platform,
	 *     interpreted by the resolver. The author writes paths at design time
	 *     so the path string should describe WHAT attribute to read, not
	 *     WHICH entity to read it from.
	 *   - `scope` is set by the calling route at solve time — opaque to the
	 *     platform, supplies the "which entity" anchor that varies per
	 *     request (segment id, parcel id, custom struct). Optional because
	 *     not every host needs it.
	 *
	 * Implementations should return ONLY the paths they successfully
	 * resolved — absent keys in the returned map signal "missing" to the
	 * caller, who then decides what to do based on the input's `onMissing`
	 * field ('fail' = error the solve, 'default' = use the input's
	 * `default`).
	 *
	 * Do not throw for individual missing paths. Throw only for
	 * resolver-wide failures (DB unreachable, configuration error). Per-path
	 * "not found" is normal and is signalled by omitting the key.
	 *
	 * Batching is intentional: a single solve often binds multiple inputs
	 * from one domain object, and the resolver should be able to do that
	 * with a single DB round-trip.
	 */
	resolve(
		ctx: RequestContext,
		paths: readonly string[],
		scope?: unknown
	): Promise<Map<string, unknown>>;
}

/**
 * Default resolver used when the host hasn't configured one. Returns an
 * empty map for any request, which makes every bound input fail at solve
 * time (with `onMissing: 'fail'`) — a loud signal that a resolver needs to
 * be wired up. Drop-in replace via `SelvaConfig.bindingResolver` once the
 * host has a real implementation.
 */
export class NoopBindingResolver implements IBindingResolver {
	async resolve(): Promise<Map<string, unknown>> {
		return new Map();
	}
}
