// Transport-free API core — handler contract, injected deps, error envelope.
//
// A host binds this by building an `ApiRequest` and calling `runHandler`; the
// handlers themselves name no web framework. See `api/README.md`.

export { ApiError, ApiErrorCode, apiError, codeForStatus, isApiError } from './errors.js';
export type { ApiHandler, ApiRequest, ApiResponse } from './types.js';
export { depsFromConfig, type SelvaDeps } from './deps.js';
export { collection, created, noContent } from './responses.js';
export { shaped, shapedCollection } from './shaped.js';
export {
	formText,
	parseBody,
	parseParam,
	requireCaller,
	requireParams,
	requireUpload,
	throwZodError
} from './request.js';
export { runHandler, toErrorBody, type ApiErrorBody, type RunHandlerOptions } from './respond.js';
export {
	createApiRateLimiter,
	defaultApiRateLimiter,
	resolveApiRateLimitConfig,
	chargeApiRateLimit,
	rateLimitHeaders,
	rateLimitedResponse,
	withRateLimitHeaders,
	DEFAULT_API_RATE_LIMIT,
	type ApiRateLimiter,
	type ApiRateLimitConfig,
	type ApiRateLimitVerdict
} from './rate-limit.js';
export {
	createApiIdempotencyStore,
	defaultApiIdempotencyStore,
	idempotencyCallerId,
	readIdempotencyKey,
	requestFingerprint,
	runIdempotent,
	IDEMPOTENCY_KEY_HEADER,
	MAX_IDEMPOTENCY_KEY_LENGTH,
	DEFAULT_API_IDEMPOTENCY_TTL_MS,
	type ApiIdempotencyStore,
	type IdempotentEntry
} from './idempotency.js';
export {
	assertScope,
	actionForMethod,
	scopeRefusalsToday,
	projectScopeTarget,
	definitionScopeTarget
} from './scope.js';
export { mapCoreError } from './map-core-error.js';
export {
	buildOpenApiDocument,
	operationId,
	type Endpoint,
	type HttpMethod,
	type Json,
	type OpenApiOptions,
	type ResponseKind
} from './openapi.js';
export { parseListOptions, parseDefinitionListOptions } from './pagination.js';
export {
	SolveBodySchema,
	CreateProjectBodySchema,
	UpdateProjectBodySchema,
	AddProjectMemberBodySchema,
	UpdateProjectMemberBodySchema,
	CreateInviteBodySchema,
	OrgComputePatchBodySchema,
	UpdateOrgMemberBodySchema,
	CreateApiTokenBodySchema
} from './bodies.js';
export {
	ShareLinkResponseSchema,
	CreatedShareLinkResponseSchema,
	InviteResponseSchema,
	CreatedInviteResponseSchema,
	OrgComputeServerResponseSchema,
	ComputeCatalogEntrySchema,
	OrgComputeResponseSchema,
	ApiTokenResponseSchema,
	CreatedApiTokenResponseSchema,
	type ShareLinkResponse
} from './responses-schema.js';
