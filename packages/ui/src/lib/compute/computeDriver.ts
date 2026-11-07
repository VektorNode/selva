import {
	createRequestResponseDriver,
	type RequestResponseDriverOptions,
	type SolveDriver,
	type SolveReporter
} from '@selvajs/solve/client';
import type { SolveFn } from '@selvajs/solve/shared';
import { meshPolicy } from '@selvajs/visualization/parse';

/**
 * The request/response driver `ComputeApp` solves through. Its memo caches whole solve results,
 * meshes included, and the viewer disposes what it renders on the next scene update.
 * `@selvajs/solve` keeps meshes opaque, so the three.js clone/dispose rules come from the renderer
 * that owns them: without `meshPolicy`, a memo hit serves an already-disposed mesh.
 */
export function createComputeDriver(
	onSolve: SolveFn,
	getReporter: () => SolveReporter,
	options: Omit<RequestResponseDriverOptions<unknown>, 'meshPolicy'>
): SolveDriver {
	return createRequestResponseDriver(onSolve, getReporter, { ...options, meshPolicy });
}
