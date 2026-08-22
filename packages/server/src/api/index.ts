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
export { runHandler, toErrorBody, type ApiErrorBody } from './respond.js';
export { mapCoreError } from './map-core-error.js';
export { parseListOptions, parseDefinitionListOptions } from './pagination.js';
export {
	SolveBodySchema,
	CreateProjectBodySchema,
	UpdateProjectBodySchema,
	AddProjectMemberBodySchema,
	UpdateProjectMemberBodySchema,
	CreateInviteBodySchema,
	OrgComputePatchBodySchema,
	UpdateOrgMemberBodySchema
} from './bodies.js';
export {
	ShareLinkResponseSchema,
	CreatedShareLinkResponseSchema,
	InviteResponseSchema,
	CreatedInviteResponseSchema,
	OrgComputeServerResponseSchema,
	ComputeCatalogEntrySchema,
	OrgComputeResponseSchema,
	type ShareLinkResponse
} from './responses-schema.js';
