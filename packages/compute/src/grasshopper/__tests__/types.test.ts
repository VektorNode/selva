/**
 * Type-level pins for the Grasshopper wire types (issues 71 & 72).
 *
 * These run as no-ops at runtime; the assertions live in the type layer and
 * are enforced by `pnpm type-check` (this file is inside the tsconfig
 * `include`), so a regression fails the build rather than a test run.
 */
import { describe, it, expect, expectTypeOf } from 'vitest';

import type { DataTree, InnerTreeData, GrasshopperComputeResponse, OutputType } from '../types';

describe('DataTree casing tolerance (issue 71)', () => {
	it('accepts PascalCase-only trees (stock mcneel servers / request shape)', () => {
		const pascal: DataTree = { ParamName: 'out', InnerTree: {} as InnerTreeData };
		expect(pascal.ParamName).toBe('out');
	});

	it('accepts camelCase fields alongside (camelCase server forks)', () => {
		const mixed: DataTree = {
			ParamName: 'out',
			InnerTree: {} as InnerTreeData,
			paramName: 'out',
			innerTree: {} as InnerTreeData
		};
		// Reading the camelCase side is typed (no cast needed) but optional.
		expectTypeOf(mixed.paramName).toEqualTypeOf<string | undefined>();
		expectTypeOf(mixed.innerTree).toEqualTypeOf<InnerTreeData | undefined>();
	});

	it('keeps PascalCase required so existing request-building code is unchanged', () => {
		expectTypeOf<DataTree['ParamName']>().toEqualTypeOf<string>();
		expectTypeOf<DataTree['InnerTree']>().toEqualTypeOf<InnerTreeData>();
	});
});

describe('GrasshopperComputeResponse honesty (issue 72)', () => {
	it('does not expose pointer — runSolve strips it into cacheKey', () => {
		expectTypeOf<GrasshopperComputeResponse>().not.toHaveProperty('pointer');
	});

	it('unenforced schema-echo fields are optional', () => {
		expectTypeOf<GrasshopperComputeResponse['cachesolve']>().toEqualTypeOf<
			boolean | null | undefined
		>();
		expectTypeOf<GrasshopperComputeResponse['dataversion']>().toEqualTypeOf<
			7 | 8 | null | undefined
		>();
		expectTypeOf<GrasshopperComputeResponse['algo']>().toEqualTypeOf<string | null | undefined>();
	});

	it('a minimal response without cachesolve/dataversion/algo type-checks', () => {
		const minimal: GrasshopperComputeResponse = {
			modelunits: 'Meters',
			filename: null,
			values: []
		};
		expect(minimal.values).toEqual([]);
	});
});

describe('OutputType keeps its literals (issue 72)', () => {
	it('still accepts arbitrary server type names', () => {
		const custom: OutputType = 'My.Plugin.CustomGoo';
		expect(custom).toBe('My.Plugin.CustomGoo');
	});

	it('does not collapse to string — literals survive Extract/narrowing', () => {
		// With the old trailing `| string` the union eagerly collapsed to
		// `string`, so Extract over a known literal produced `never`.
		expectTypeOf<
			Extract<OutputType, 'Rhino.Geometry.Mesh'>
		>().toEqualTypeOf<'Rhino.Geometry.Mesh'>();
		expectTypeOf<Extract<OutputType, 'System.String'>>().toEqualTypeOf<'System.String'>();
	});
});
