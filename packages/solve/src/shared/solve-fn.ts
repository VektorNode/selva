/**
 * The solve contract — what a solve returns and what a caller supplies to run one.
 *
 * Lives in `shared/` because both halves of the package speak it: `client/` calls a `SolveFn` and
 * stores its `SolveResult`; `server/` produces the payload one is built from.
 */

/**
 * `TMesh` is deliberately opaque and defaults to `unknown`: this package never inspects meshes, and
 * typing them would drag a renderer dependency into a package whose whole point is not having one.
 * The app that owns assembly (parse → `THREE.Object3D[]`) is the only place that knows the concrete
 * type, and it narrows by writing `SolveResult<THREE.Object3D>` at its own seam.
 */
export interface SolveResult<TMesh = unknown> {
	outputs: Record<string, unknown>;
	meshes?: TMesh[];
	errors?: string[];
	warnings?: string[];
}

/** Implementations should listen to `signal` and abort/clean up when it fires. */
export type SolveFn<TMesh = unknown> = (
	values: Record<string, unknown>,
	signal: AbortSignal
) => Promise<SolveResult<TMesh>>;
