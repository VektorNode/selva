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
} from './scheduler/solve-scheduler';

// Stable keying helpers — exported so an app-layer durable cache or a
// pre-solved bundle viewer can reproduce the scheduler's exact solve key.
// See `scheduler/stable-hash.ts` for the key-parity contract.
export { stableStringify, hashDefinition, hashSolveInput } from './scheduler/stable-hash';

// ============================================================================
// COMPUTATION
// ============================================================================
export { solveGrasshopperDefinition } from './solve';

// Backend-agnostic definition forms — they live in `core/` (a second backend must
// not have to import them from this subpath) and are re-exported here for the
// existing Grasshopper call sites.
export { isDefinitionRef } from '@/core/definition-ref';
export type { DefinitionRef, SolveDefinition } from '@/core/definition-ref';

// ============================================================================
// SERVER MONITORING
// ============================================================================
// rhino.compute's control plane (/activechildren, /plugins/gh/installed,
// /idlespan) — Grasshopper-specific, so it lives on this subpath, not `/core`.
export { default as ComputeServerStats } from './server/compute-server-stats';

// ============================================================================
// I/O PROCESSING
// ============================================================================
export { fetchDefinitionIO, fetchParsedDefinitionIO } from './io/definition-io';
export { readSchemaResults } from './io/schema-endpoint';
export type { SchemaEndpointResult } from './io/schema-endpoint';
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
// FILE HANDLING (generic — implementation lives in core/files)
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
	GrasshopperComputeResponse,
	InputParamSchema,
	OutputParamSchema,
	GrasshopperParsedIORaw,
	GrasshopperParsedIO
} from './types';
