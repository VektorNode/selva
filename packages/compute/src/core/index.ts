/**
 * Core utilities and configuration for @selvajs/compute
 *
 * This module provides the foundational building blocks for the library, including:
 * - **Networking**: Type-safe HTTP wrappers for the Rhino Compute API
 * - **Server Monitoring**: Health checks and telemetry monitoring
 * - **Error Handling**: Specialized error classes for API and network failures
 * - **Logging**: Configurable debug and production logging
 *
 * @example Performing a low-level compute request
 * ```typescript
 * import { fetchRhinoCompute, RhinoComputeError } from '@selvajs/compute/core';
 *
 * try {
 *   // POST to the Grasshopper solve endpoint (fetchRhinoCompute always POSTs JSON)
 *   const data = await fetchRhinoCompute(
 *     'grasshopper',
 *     { pointer: definitionUrl, values: inputTree },
 *     config
 *   );
 *   console.log('Solve response:', data);
 * } catch (error) {
 *   if (error instanceof RhinoComputeError) {
 *     console.error(`API Error [${error.code}]: ${error.message}`);
 *   }
 * }
 * ```
 *
 * @example Monitoring server status
 * ```typescript
 * import { ComputeServerStats } from '@selvajs/compute/core';
 *
 * const stats = new ComputeServerStats(serverUrl, apiKey);
 * if (await stats.isServerOnline()) {
 *   const info = await stats.getServerStats();
 *   // version is an object: { rhino, compute, git_sha }
 *   console.log(`Compute Version: ${info.version?.compute}`);
 * }
 * await stats.dispose();
 * ```
 *
 * @module core
 */

export { fetchRhinoCompute } from './compute-fetch/compute-fetch';
export { getResponseWireSize, setResponseWireSize } from './compute-fetch/wire-size';

export { default as ComputeServerStats } from './server/compute-server-stats';

export { RhinoComputeError, ErrorCodes } from './errors';
export type { ErrorCode } from './errors';

// Logging
export type { Logger } from './utils/logger';
export { setLogger, enableDebugLogging, getLogger } from './utils/logger';

// String utilities
export { toCamelCase, camelcaseKeys } from './utils/camel-case';

// Configuration
export type { ComputeConfig, RhinoModelUnit, RetryPolicy, ServerTiming } from './types';

export { extractFilesFromComputeResponse, downloadFileData } from './files/handle-files';
export type { ProcessedFile, FileData, FileBaseInfo } from './files/types';
