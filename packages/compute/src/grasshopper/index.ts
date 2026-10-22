/**
 * Grasshopper computation and I/O processing
 *
 * This module provides client APIs and utilities for working with
 * Grasshopper definitions and Rhino Compute.
 */

// ============================================================================
// CLIENT API (Recommended)
// ============================================================================
export { default as GrasshopperClient } from './client/grasshopper-client';
export type { SolveOptions, CreateClientOptions } from './client/grasshopper-client';
export { default as GrasshopperResponseProcessor } from './client/grasshopper-response-processor';

// ============================================================================
// SCHEDULER
// ============================================================================
export { SolveScheduler } from './scheduler/solve-scheduler';
export type {
	SchedulerMode,
	CacheOptions,
	SolveSchedulerOptions,
	SolveContext,
	SolveResult,
	SolveDetail,
	SchedulerSolveOptions,
	SolveExecutor
} from './scheduler/types';
export { stableStringify, hashDefinition, hashSolveInput } from './scheduler/stable-hash';

// ============================================================================
// COMPUTATION
// ============================================================================
export { solveGrasshopperDefinition } from './solve';

// ============================================================================
// SERVER MONITORING
// ============================================================================
export { default as ComputeServerStats } from './server/compute-server-stats';
export type { ServerVersion, ServerStats } from './server/compute-server-stats';

// ============================================================================
// I/O PROCESSING
// ============================================================================
export { fetchDefinitionIO, fetchParsedDefinitionIO } from './io/definition-io';
export { readSchemaResults } from './io/schema-endpoint';
export type { SchemaEndpointResult } from './io/schema-endpoint';
export { normalizeUISchemaCasing } from './io/normalize-ui-schema';
export { processInput } from './io/input/input-processors';
export type {
	GetValuesOptions,
	GetValuesResult,
	ParsedContext
} from './io/output/response-processors';
export { disposeRhinoObjects, isRhinoDecodeError } from './io/output/rhino-objects';
export type { RhinoDecodeError } from './io/output/rhino-objects';

// ============================================================================
// DATA STRUCTURES
// ============================================================================
export { TreeBuilder } from './data-tree/data-tree';
export type { DataTreeValue, TreeValueEntry } from './data-tree/data-tree';

// ============================================================================
// TYPES
// ============================================================================
export type {
	RhinoModelUnit,
	DataTreePath,
	DataItem,
	DataTreeDefault,
	InnerTreeData,
	DataTree,
	DefaultValue,
	NumericInputType,
	TextInputType,
	BooleanInputType,
	GeometryInputType,
	ValueListInputType,
	FileInputType,
	ColorInputType,
	InputParam,
	GrasshopperComputeConfig,
	SelvaEventTarget,
	SelvaResponseBlock,
	GrasshopperComputeResponse,
	InputParamSchema,
	OutputParamSchema,
	GrasshopperParsedIORaw,
	GrasshopperParsedIO,
	InputParseError
} from './types';
