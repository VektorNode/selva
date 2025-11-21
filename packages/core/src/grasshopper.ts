/**
 * Grasshopper-specific compute functionality
 *
 * This module provides both high-level and low-level APIs for working with
 * Grasshopper definitions and Rhino Compute servers.
 *
 * @example High-level usage
 * ```typescript
 * import { GrasshopperClient } from 'rhino-compute-core/grasshopper';
 *
 * const client = new GrasshopperClient({ serverUrl: 'http://localhost:8081' });
 * const result = await client.solve(definitionUrl, dataTree);
 * ```
 *
 * @example Low-level usage
 * ```typescript
 * import { solveGrasshopperDefinition, normalizeComputeConfig } from 'rhino-compute-core/grasshopper';
 *
 * const config = normalizeComputeConfig({ serverUrl: 'http://localhost:8081' });
 * const result = await solveGrasshopperDefinition(dataTree, definition, config);
 * ```
 *
 * @module grasshopper
 */

// ============================================================================
// CLIENT API (Recommended for most users)
// ============================================================================

export { GrasshopperResponseProcessor, GrasshopperClient } from './features/grasshopper';

// ============================================================================
// COMPUTE FUNCTIONS (Low-level API)
// ============================================================================

export { solveGrasshopperDefinition } from './features/grasshopper';

// ============================================================================
// DEFINITION I/O (Get inputs and outputs from definitions)
// ============================================================================

export { fetchDefinitionIO, fetchParsedDefinitionIO } from './features/grasshopper';

// ============================================================================
// INPUT HELPERS (Convert data to DataTree format)
// ============================================================================

export {
  groupInputs,
  groupInputsNested,
  inputsToDataTrees,
  groupedInputsToDataTrees,
  isDataTreeStructure,
  processInputs,
  processInput,
  buildDataTree,
  replaceTreeValue,
} from './features/grasshopper';

// ============================================================================
// OUTPUT PROCESSORS (Extract data from compute responses)
// ============================================================================

export { extractFileData, getParameter, getParameterNames } from './features/grasshopper/io/output';

// ============================================================================
// TYPE EXPORTS (Public types for this module)
// ============================================================================

// Core Grasshopper types
export type {
  DataTree,
  DataItem,
  GrasshopperParsedIO,
  GrasshopperRequestSchema,
  GrasshopperComputeResponse,
  GrasshopperComputeConfig,
} from './features/grasshopper/types';

// Input types
export type {
  InputParam,
  NumericInputType,
  TextInputType,
  BooleanInputType,
  GeometryInputType,
  PointInputType,
  LineInputType,
  GroupInputs,
  NestedGroupInputs,
  NestedGroupNode,
  InputParamSchema,
  ValueListInputType,
  DataTreeDefault,
} from './features/grasshopper/types';

// Output types
export type { ParamOutputSchema, OutputType } from './features/grasshopper/types';

// Error types
export { RhinoComputeError } from './core';
