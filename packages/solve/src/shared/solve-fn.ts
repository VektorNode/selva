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
export interface SolveResult<TMesh = unknown, TSource = unknown> {
	outputs: Record<string, unknown>;
	meshes?: TMesh[];
	errors?: string[];
	warnings?: string[];
	/**
	 * The unparsed payload this result was built from, passed through verbatim. Opaque here for the
	 * same reason as `TMesh`: a consumer that must persist or re-submit exactly what it showed the
	 * user narrows it at its own seam. Travels with the result through the driver's memo, so a
	 * cached hit carries the source that produced it. Unlike `meshes` it needs no ownership policy —
	 * it is inert data, not a GPU-backed handle.
	 */
	source?: TSource;
	/**
	 * The input set that produced this result, stamped by the driver rather than the `SolveFn` — a
	 * memo hit never calls the `SolveFn`, so a consumer reading values captured inside it would pair
	 * the on-screen result with whatever solved last. Keeping the pair atomic is the point: a commit
	 * path holding a `SolveResult` cannot mismatch artifact and inputs.
	 */
	values?: Record<string, unknown>;
}

/** Implementations should listen to `signal` and abort/clean up when it fires. */
export type SolveFn<TMesh = unknown, TSource = unknown> = (
	values: Record<string, unknown>,
	signal: AbortSignal
) => Promise<SolveResult<TMesh, TSource>>;
