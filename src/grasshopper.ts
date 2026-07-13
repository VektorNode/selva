/**
 * Grasshopper-specific compute functionality
 *
 * This module provides both high-level and low-level APIs for working with
 * Grasshopper definitions and Rhino Compute servers.
 *
 * @example High-level usage
 * ```typescript
 * import { GrasshopperClient } from '@selvajs/compute/grasshopper';
 *
 * const client = new GrasshopperClient({ serverUrl: 'http://localhost:8081' });
 * const result = await client.solve(definitionUrl, dataTree);
 * ```
 *
 * @example Low-level usage
 * ```typescript
 * import { solveGrasshopperDefinition } from '@selvajs/compute/grasshopper';
 *
 * const result = await solveGrasshopperDefinition(dataTree, definition, {
 * 	serverUrl: 'http://localhost:8081'
 * });
 * ```
 *
 * @module grasshopper
 */

export { GrasshopperResponseProcessor, GrasshopperClient } from './features/grasshopper';
export type { SolveOptions } from './features/grasshopper';

export { SolveScheduler } from './features/grasshopper';
export type {
	SchedulerMode,
	CacheOptions,
	SolveSchedulerOptions,
	SolveContext,
	SolveResult
} from './features/grasshopper';

export { stableStringify, hashDefinition, hashSolveInput } from './features/grasshopper';
// The definition forms these keying helpers (and `SolveScheduler.solve`) accept.
export { isDefinitionRef } from './features/grasshopper';
export type { DefinitionRef, SolveDefinition } from './features/grasshopper';

export { solveGrasshopperDefinition } from './features/grasshopper';

export { fetchDefinitionIO, fetchParsedDefinitionIO } from './features/grasshopper';

export { processInputs, processInput, TreeBuilder } from './features/grasshopper';
export type { DataTreeValue } from './features/grasshopper';

export { extractFilesFromComputeResponse, downloadFileData } from './features/grasshopper';
export type { ProcessedFile, FileData, FileBaseInfo } from './features/grasshopper';

export type {
	DataTreePath,
	DataItem,
	DataTree,
	DataTreeDefault,
	DefaultValue,
	InnerTreeData,
	GrasshopperParsedIO,
	GrasshopperParsedIORaw,
	GrasshopperRequestSchema,
	GrasshopperComputeResponse,
	GrasshopperComputeConfig,
	InputParam,
	NumericInputType,
	TextInputType,
	BooleanInputType,
	GeometryInputType,
	InputParamSchema,
	ValueListInputType,
	FileInputType,
	OutputParamSchema,
	OutputType
} from './features/grasshopper';

export type { GetValuesOptions, GetValuesResult, ParsedContext } from './features/grasshopper';

export { RhinoComputeError } from './core';
export type { ComputeConfig, RhinoModelUnit, RetryPolicy } from './core';
