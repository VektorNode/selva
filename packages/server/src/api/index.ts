// Transport-free API core — handler contract, injected deps, error envelope.
//
// A host binds this by building an `ApiRequest` and calling `runHandler`; the
// handlers themselves name no web framework. See `api/README.md`.

export { ApiError, ApiErrorCode, apiError, codeForStatus, isApiError } from './errors.js';
export type { ApiHandler, ApiRequest, ApiResponse } from './types.js';
export { depsFromConfig, type SelvaDeps } from './deps.js';
export { collection, created, noContent } from './responses.js';
export { runHandler, toErrorBody, type ApiErrorBody } from './respond.js';
