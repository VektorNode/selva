/**
 * Compute error types, kept in a leaf module with no imports.
 *
 * Separate from the function that throws them on purpose: an error mapper needs
 * nothing but the class to `instanceof` against, and importing it from beside
 * the throw site drags that module's dependencies into every mapper. Anything
 * an error mapper imports belongs here.
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
