/**
 * The solve contract — what a solve returns and what a caller supplies to run one.
 *
 * Lives in `shared/` because both halves of the package speak it: `client/` calls a `SolveFn` and
 * stores its `SolveResult`; `server/` produces the payload one is built from.
 */

/**
 * Result returned from a solve operation.
 *
 * `TMesh` is deliberately opaque and defaults to `unknown`: this package never inspects meshes, and
 * typing them would drag a renderer dependency into a package whose whole point is not having one.
 * The app that owns assembly (parse → `THREE.Object3D[]`) is the only place that knows the concrete
 * type, and it narrows by writing `SolveResult<THREE.Object3D>` at its own seam.
 *
 * @property outputs - Key-value pairs of computed results
 * @property meshes - Optional renderable payload, opaque to this package
 * @property errors - Optional array of error messages that occurred
 * @property warnings - Optional array of warning messages from the computation
 */
export interface SolveResult<TMesh = unknown> {
	outputs: Record<string, unknown>;
	meshes?: TMesh[];
	errors?: string[];
	warnings?: string[];
}

/**
 * Function type for running a computation with given input values.
 *
 * Implementations should listen to the abort signal and clean up resources
 * when the signal is triggered (e.g., when the user cancels the operation).
 *
 * @param values - Input parameters for the computation
 * @param signal - AbortSignal to cancel ongoing operations
 * @returns Promise resolving to the computation result
 */
export type SolveFn<TMesh = unknown> = (
	values: Record<string, unknown>,
	signal: AbortSignal
) => Promise<SolveResult<TMesh>>;
