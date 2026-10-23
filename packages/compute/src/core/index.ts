/**
 * The transport under `/grasshopper`, usable on its own:
 * - **Networking**: retry, backoff, abort composition, `Retry-After`, status→code mapping
 * - **Errors**: one `ComputeError` class with a typed `code`
 * - **Logging**: a pluggable logger, silent by default
 * - **Definitions**: the by-value / by-reference forms a solve accepts
 * - **Files**: decoding and downloading the files a solve returns
 *
 * @module core
 */

export { fetchCompute } from './compute-fetch/compute-fetch';

export { ComputeError, ErrorCodes } from './errors';
export type { ErrorCode } from './errors';

// Logging
export type { Logger } from './utils/logger';
export { setLogger, enableDebugLogging, getLogger } from './utils/logger';

export { readField, hasField } from './utils/read-field';

export { decodeBase64ToBinary } from './utils/encoding';

// Configuration
export type {
	ComputeAuth,
	ComputeConfig,
	RetryPolicy,
	ServerErrorCodeMap,
	ServerTiming
} from './types';

// Definition forms — backend-agnostic (bytes, or a lazy identity-keyed byte ref),
// so a second backend's solve signature doesn't reach into `/grasshopper`.
export { isDefinitionRef } from './definition-ref';
export type { DefinitionRef, SolveDefinition } from './definition-ref';

export { validateServerUrl, DEFAULT_BLOCKED_HOST } from './server/validate-server-url';
export type { ValidateServerUrlOptions } from './server/validate-server-url';
export { classifyProbeFailure } from './server/classify-probe-failure';
export type { ProbeFailure, ProbeVerdict } from './server/classify-probe-failure';

export {
	extractFilesFromComputeResponse,
	downloadFileData,
	downloadFileDataByRoot
} from './files/handle-files';
// rootOf/pathBelowRoot/toArchiveName stay internal: they're the grouping's mechanics, and
// groupFilesByRoot is the whole convention a consumer needs.
export { groupFilesByRoot, subFolderSegments } from './files/sub-folder';
export type { ProcessedFile, FileData, FileBaseInfo, DownloadOptions } from './files/types';
