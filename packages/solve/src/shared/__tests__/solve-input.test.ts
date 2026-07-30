/**
 * `shared/` is types-only, so these are compile-time assertions with a runtime shell.
 *
 * They exist for one reason: this package's whole claim is that `client/` and `server/` speak ONE
 * vocabulary. Both properties below were true by accident before and can regress silently — a
 * widened `SolveResult.meshes` reintroduces the renderer leak C1 closed, and a `SolveInput` that
 * stops matching the pipeline's old `PipelineInput` re-forks the type this package merged.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { SchemaInput } from '@selvajs/schemas';

import type { SolveFn, SolveInput, SolveResult } from '../index.js';

describe('SolveResult', () => {
	it('keeps meshes opaque by default (C1 — no renderer dependency)', () => {
		// `unknown[]`, not `any[]`: the old `any[]` is what let the memo silently reinterpret meshes
		// as `THREE.Object3D[]` with nothing in the type system holding the seam.
		expectTypeOf<SolveResult['meshes']>().toEqualTypeOf<unknown[] | undefined>();
	});

	it('narrows to a concrete mesh type at the app seam', () => {
		type Obj3D = { isObject3D: true };
		expectTypeOf<SolveResult<Obj3D>['meshes']>().toEqualTypeOf<Obj3D[] | undefined>();
	});

	it('carries outputs plus optional diagnostics', () => {
		const result: SolveResult = { outputs: { a: 1 }, errors: ['boom'], warnings: ['hmm'] };
		expect(result.outputs.a).toBe(1);
		expectTypeOf<SolveResult['outputs']>().toEqualTypeOf<Record<string, unknown>>();
	});
});

describe('SolveFn', () => {
	it('takes values + an abort signal and resolves a same-typed result', async () => {
		type Obj3D = { isObject3D: true };
		const solve: SolveFn<Obj3D> = async (values, signal) => {
			expect(signal.aborted).toBe(false);
			return { outputs: values, meshes: [{ isObject3D: true }] };
		};

		const result = await solve({ radius: 5 }, new AbortController().signal);
		expect(result.outputs.radius).toBe(5);
		expect(result.meshes?.[0].isObject3D).toBe(true);
	});
});

describe('SolveInput', () => {
	it('is a SchemaInput widened with the optional numeric bounds the transform reads', () => {
		expectTypeOf<SolveInput>().toExtend<SchemaInput>();
		expectTypeOf<SolveInput['minimum']>().toEqualTypeOf<number | undefined>();
		expectTypeOf<SolveInput['maximum']>().toEqualTypeOf<number | undefined>();
		expectTypeOf<SolveInput['stepSize']>().toEqualTypeOf<number | undefined>();
	});

	it('accepts an input carrying no bounds (non-numeric params carry none)', () => {
		const input = { id: 'a', nickname: 'A', paramType: 'text' } as SolveInput;
		expect(input.minimum).toBeUndefined();
	});
});
