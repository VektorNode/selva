// Compile-time assertions, enforced by `tsc --noEmit`: nothing here runs. `client/` and `server/`
// speak one vocabulary, and a widened `SolveResult.meshes` would reopen a renderer leak.

import type { SchemaInput } from '@selvajs/schemas';
import type { SolveFn, SolveInput, SolveResult } from '../index.js';

type Equals<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Extends<A, B> = A extends B ? true : false;
type Assert<T extends true> = T;

type Obj3D = { isObject3D: true };

export type Checks = [
	// `unknown[]`, not `any[]`: `any[]` would let the memo silently reinterpret meshes as
	// `THREE.Object3D[]` with nothing in the type system to catch it.
	Assert<Equals<SolveResult['meshes'], unknown[] | undefined>>,
	Assert<Equals<SolveResult<Obj3D>['meshes'], Obj3D[] | undefined>>,
	Assert<Equals<SolveResult['outputs'], Record<string, unknown>>>,
	Assert<Equals<Awaited<ReturnType<SolveFn<Obj3D>>>['meshes'], Obj3D[] | undefined>>,
	Assert<Extends<SolveInput, SchemaInput>>,
	Assert<Equals<SolveInput['minimum'], number | undefined>>,
	Assert<Equals<SolveInput['maximum'], number | undefined>>
];
