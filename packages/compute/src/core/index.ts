/**
 * Core utilities and configuration for @selvajs/compute
 *
 * Backend-agnostic transport: nothing here knows about Grasshopper or Rhino.
 * - **Networking**: retry, backoff, abort composition, `Retry-After`, status→code mapping
 * - **Error Handling**: Specialized error classes for API and network failures
 * - **Logging**: Configurable debug and production logging
 * - **Definitions**: the by-value / by-reference forms a solve accepts
 *
 * @example Performing a low-level compute request
 * ```typescript
 * import { fetchCompute, ComputeError } from '@selvajs/compute/core';
 *
 * try {
 *   // POST to the Grasshopper solve endpoint (fetchCompute always POSTs JSON)
 *   const data = await fetchCompute(
 *     'grasshopper',
 *     { pointer: definitionUrl, values: inputTree },
 *     config
 *   );
 *   console.log('Solve response:', data);
 * } catch (error) {
 *   if (error instanceof ComputeError) {
 *     console.error(`API Error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 *
 * @module core
 */

export { fetchCompute } from './compute-fetch/compute-fetch';
export { getResponseWireSize, setResponseWireSize } from './compute-fetch/wire-size';

export { ComputeError, ErrorCodes } from './errors';
export type { ErrorCode } from './errors';

// Logging
export type { Logger } from './utils/logger';
export { setLogger, enableDebugLogging, getLogger } from './utils/logger';

// Wire-payload field reader. Server branches disagree on casing (mcneel serializes
// the IO schema PascalCase, the VektorNode fork camelCase), so read the specific
// fields you need case-insensitively rather than rewriting every key — a blanket
// rewrite corrupts user-authored keys like value-list labels.
export { readField, hasField } from './utils/read-field';

// Encoding utilities. `@selvajs/visualization` keeps its own copy of this logic rather than
// importing it — it raises `VisualizationError`, and importing would couple it to the Compute
// client for ~20 lines. If the forgiving-base64 normalization or the Node pool-slab copy changes
// here, `packages/visualization/src/shared/encoding.ts` must change with it.
export { decodeBase64ToBinary } from './utils/encoding';

// Configuration
export type { ComputeConfig, RetryPolicy, ServerErrorCodeMap, ServerTiming } from './types';

// Definition forms — backend-agnostic (bytes, or a lazy identity-keyed byte ref),
// so a second backend's solve signature doesn't reach into `/grasshopper`.
export { isDefinitionRef } from './definition-ref';
export type { DefinitionRef, SolveDefinition } from './definition-ref';

export { validateServerUrl, DEFAULT_BLOCKED_HOST } from './server/validate-server-url';
export type { ValidateServerUrlOptions } from './server/validate-server-url';

export {
	extractFilesFromComputeResponse,
	downloadFileData,
	downloadFileDataByRoot
} from './files/handle-files';
// rootOf/pathBelowRoot/toArchiveName stay internal: they're the grouping's mechanics, and
// groupFilesByRoot is the whole convention a consumer needs.
export { groupFilesByRoot, subFolderSegments } from './files/sub-folder';
export type { ProcessedFile, FileData, FileBaseInfo } from './files/types';
