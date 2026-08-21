/**
 * Compute error types, kept in a leaf module with no imports.
 *
 * Separate from `resolve.server.ts` on purpose. That module value-imports
 * `providers.server.ts`, which runs a top-level `await createSelvaProviders()`
 * at import time — so the error mappers in `api-errors.ts` and
 * `api/sveltekit.ts`, which need nothing but the class to `instanceof` against,
 * were booting the entire provider stack to get it. That edge pulled `$env`
 * into every transport-free handler that touches the v1 route helpers.
 *
 * Anything imported by an error mapper belongs here rather than beside the
 * function that throws it.
 */

/**
 * Thrown when no compute server is configured or visible for the org — a
 * misconfiguration an operator must fix in `/admin/compute`, not a bug. Routes
 * map this to 503 instead of letting the pure helper's plain `Error` surface as
 * a generic 500.
 */
export class ComputeServerUnconfiguredError extends Error {
	constructor(
		message = 'No compute server configured. Ask an admin to add one in /admin/compute.'
	) {
		super(message);
		this.name = 'ComputeServerUnconfiguredError';
	}
}
