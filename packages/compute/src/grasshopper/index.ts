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
export type { SolveOptions } from './client/grasshopper-client';
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
	SolveResult
} from './scheduler/types';
export { stableStringify, hashDefinition, hashSolveInput } from './scheduler/stable-hash';

// ============================================================================
// COMPUTATION
// ============================================================================
export { solveGrasshopperDefinition } from './solve';
export { isDefinitionRef } from '@/core/definition-ref';
export type { DefinitionRef, SolveDefinition } from '@/core/definition-ref';

// ============================================================================
// SERVER MONITORING
// ============================================================================
export { default as ComputeServerStats } from './server/compute-server-stats';

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

// ============================================================================
// DATA STRUCTURES
// ============================================================================
export { TreeBuilder } from './data-tree/data-tree';
export type { DataTreeValue } from './data-tree/data-tree';

// ============================================================================
// FILE HANDLING
// ============================================================================
export { extractFilesFromComputeResponse, downloadFileData } from '@/core/files/handle-files';
export type { ProcessedFile, FileData, FileBaseInfo } from '@/core/files/types';

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
	OutputType,
	DefaultValue,
	NumericInputType,
	TextInputType,
	BooleanInputType,
	GeometryInputType,
	ValueListInputType,
	FileInputType,
	InputParam,
	GrasshopperComputeConfig,
	GrasshopperRequestSchema,
	SelvaEventTarget,
	SelvaResponseBlock,
	GrasshopperComputeResponse,
	InputParamSchema,
	OutputParamSchema,
	GrasshopperParsedIORaw,
	GrasshopperParsedIO
} from './types';
