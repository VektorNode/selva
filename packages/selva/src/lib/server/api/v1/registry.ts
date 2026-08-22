/**
 * The v1 contract as data: one entry per method+path, naming its body validator,
 * response shape, and whether it's public or internal.
 *
 * Both the OpenAPI generator and the conformance test read this file. The test
 * walks `routes/api/v1/**` against this table and fails if either side has an
 * entry the other doesn't — a route with no registry entry is undocumented, a
 * registry entry with no route is a spec promising something that 404s.
 *
 * Request schemas are Zod values imported from `@selvajs/server/api`, not transcribed,
 * so a renamed field changes the spec on the next generate instead of silently
 * disagreeing with the validator.
 */

import type { ZodType } from 'zod';
import {
	SolveBodySchema,
	CreateProjectBodySchema,
	UpdateProjectBodySchema,
	AddProjectMemberBodySchema,
	UpdateProjectMemberBodySchema,
	CreateInviteBodySchema,
	UpdateOrgMemberBodySchema,
	OrgComputePatchBodySchema
} from '@selvajs/server/api';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * `collection` is the paginated `{ items, nextCursor? }` envelope and implies
 * the `limit`/`cursor` query params. The conformance test keys its pagination
 * assertion off this — mislabelling a list endpoint as `object` is how an
 * unpaginated collection ships.
 */
export type ResponseKind = 'collection' | 'object' | 'empty' | 'binary';

export interface Endpoint {
	method: HttpMethod;
	/** OpenAPI path with `{param}` placeholders — not SvelteKit's `[param]`. */
	path: string;
	summary: string;
	/** Excluded from published docs; may change without notice. */
	internal?: boolean;
	response: ResponseKind;
	/** Success status when it isn't 200 (or 204 for `empty`). */
	status?: number;
	requestBody?: ZodType;
	/** Multipart form fields, for handlers that take `FormData` instead of JSON. */
	multipart?: { field: string; required: boolean; description: string }[];
	/** Query params beyond the standard pagination set. */
	query?: { name: string; description: string }[];
	/** Documented failure statuses beyond the always-possible 401/500. */
	errors?: number[];
}

const solveErrors = [400, 401, 404, 429, 503];

export const V1_ENDPOINTS: Endpoint[] = [
	// ==========================================================================
	// Me
	// ==========================================================================
	{
		method: 'GET',
		path: '/me',
		summary: 'The calling identity, its acting org, and its effective permissions.',
		response: 'object'
	},
	{
		method: 'PUT',
		path: '/me/starred/{guid}',
		summary: 'Star a definition. Idempotent.',
		response: 'empty',
		errors: [404]
	},
	{
		method: 'DELETE',
		path: '/me/starred/{guid}',
		summary: 'Unstar a definition. Idempotent.',
		response: 'empty'
	},

	// ==========================================================================
	// Definitions
	// ==========================================================================
	{
		method: 'GET',
		path: '/definitions',
		summary: 'List definitions the caller can see.',
		response: 'collection',
		query: [
			{ name: 'projectId', description: 'Restrict to one project.' },
			{ name: 'status', description: 'One of `draft`, `published`, `archived`.' }
		]
	},
	{
		method: 'POST',
		path: '/definitions',
		summary: 'Create a definition from a Grasshopper file.',
		response: 'object',
		status: 201,
		multipart: [
			{ field: 'file', required: true, description: 'The `.gh` or `.ghx` file.' },
			{ field: 'projectId', required: true, description: 'Owning project.' },
			{ field: 'displayName', required: true, description: 'Human-readable name.' },
			{ field: 'description', required: false, description: 'Long description.' },
			{ field: 'category', required: false, description: 'Grouping label.' },
			{ field: 'tags', required: false, description: 'Comma-separated tags.' },
			{ field: 'image', required: false, description: 'Cover image.' },
			{ field: 'computeServerId', required: false, description: 'Pin to a compute server.' }
		],
		errors: [400, 403, 422, 503]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}',
		summary: 'Definition record plus its live and draft version summaries.',
		response: 'object',
		errors: [404]
	},
	{
		method: 'PATCH',
		path: '/definitions/{guid}',
		summary: 'Update definition metadata.',
		response: 'empty',
		errors: [400, 404]
	},
	{
		method: 'DELETE',
		path: '/definitions/{guid}',
		summary: 'Soft-delete a definition.',
		response: 'empty',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/solve',
		summary: 'Solve a definition. The primary action of the API.',
		response: 'object',
		requestBody: SolveBodySchema,
		errors: solveErrors
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/schema',
		summary: "The live version's UI schema. 404 when nothing is published.",
		response: 'object',
		errors: [404]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/versions',
		summary: 'List versions, newest first.',
		response: 'collection',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/versions',
		summary: 'Upload a new version.',
		response: 'object',
		status: 201,
		multipart: [
			{ field: 'file', required: true, description: 'The `.gh` or `.ghx` file.' },
			{ field: 'changeNote', required: false, description: 'Truncated to 1000 characters.' }
		],
		errors: [400, 404, 422, 503]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/versions/{versionId}',
		summary: 'One version, without its cached schema.',
		response: 'object',
		errors: [404]
	},
	{
		method: 'DELETE',
		path: '/definitions/{guid}/versions/{versionId}',
		summary: 'Delete a version. 409 when it is the live or draft pointer.',
		response: 'empty',
		errors: [404, 409]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/versions/{versionId}/schema',
		summary: "That version's cached UI schema. No compute round-trip.",
		response: 'object',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/publish',
		summary: 'Promote a version to live.',
		response: 'object',
		errors: [400, 404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/image',
		summary: 'Upload a cover image.',
		response: 'object',
		multipart: [{ field: 'image', required: true, description: 'PNG, JPEG, WebP or GIF.' }],
		errors: [400, 404]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/share-links',
		summary: 'List share links. 404 when sharing is disabled on the instance.',
		response: 'collection',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/share-links',
		summary: 'Create a share link. The raw token is returned once and never again.',
		response: 'object',
		status: 201,
		errors: [400, 404]
	},
	{
		method: 'DELETE',
		path: '/definitions/{guid}/share-links/{linkId}',
		summary: 'Revoke a share link.',
		response: 'empty',
		errors: [404]
	},

	// ==========================================================================
	// Projects
	// ==========================================================================
	{
		method: 'GET',
		path: '/projects',
		summary: 'List projects the caller can view.',
		response: 'collection'
	},
	{
		method: 'POST',
		path: '/projects',
		summary: 'Create a project.',
		response: 'object',
		status: 201,
		requestBody: CreateProjectBodySchema,
		errors: [400, 403, 409]
	},
	{
		method: 'GET',
		path: '/projects/{id}',
		summary: "Project record plus the caller's effective role and capabilities.",
		response: 'object',
		errors: [404]
	},
	{
		method: 'PATCH',
		path: '/projects/{id}',
		summary: 'Update project settings. Owner-only.',
		response: 'empty',
		requestBody: UpdateProjectBodySchema,
		errors: [400, 403, 404, 409]
	},
	{
		method: 'DELETE',
		path: '/projects/{id}',
		summary: 'Delete a project.',
		response: 'empty',
		errors: [403, 404]
	},
	{
		method: 'GET',
		path: '/projects/{id}/members',
		summary: 'List project members.',
		response: 'collection',
		errors: [403, 404]
	},
	{
		method: 'POST',
		path: '/projects/{id}/members',
		summary: 'Add a member. The target must already belong to the org.',
		response: 'object',
		status: 201,
		requestBody: AddProjectMemberBodySchema,
		errors: [400, 403, 404]
	},
	{
		method: 'PATCH',
		path: '/projects/{id}/members/{userId}',
		summary: 'Change a member role.',
		response: 'empty',
		requestBody: UpdateProjectMemberBodySchema,
		errors: [400, 403, 404, 409]
	},
	{
		method: 'DELETE',
		path: '/projects/{id}/members/{userId}',
		summary: 'Remove a member. Idempotent.',
		response: 'empty',
		query: [
			{
				name: 'confirm',
				description: 'Set to `true` to remove a co-owner; without it the call returns 409.'
			}
		],
		errors: [403, 404, 409]
	},
	{
		method: 'POST',
		path: '/projects/{id}/reclaim',
		summary: 'Claim ownership of an unowned project.',
		response: 'object',
		status: 201,
		errors: [403, 404, 409]
	},

	// ==========================================================================
	// Orgs
	// ==========================================================================
	{
		method: 'GET',
		path: '/orgs/{orgId}',
		summary: "Org record. The org must be the caller's acting org.",
		response: 'object',
		errors: [403, 404]
	},
	{
		method: 'GET',
		path: '/orgs/{orgId}/members',
		summary: 'List org members.',
		response: 'collection',
		errors: [403]
	},
	{
		method: 'PATCH',
		path: '/orgs/{orgId}/members/{userId}',
		summary: 'Change an org role or permission set. The sole owner cannot be demoted.',
		response: 'empty',
		requestBody: UpdateOrgMemberBodySchema,
		errors: [400, 403, 404, 409]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/members/{userId}',
		summary: 'Remove an org member. The sole owner cannot be removed.',
		response: 'empty',
		errors: [403, 404, 409]
	},
	{
		method: 'GET',
		path: '/orgs/{orgId}/invites',
		summary: 'List pending invites.',
		response: 'collection',
		errors: [403]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/invites',
		summary: 'Invite someone to the org. The accept URL is returned once.',
		response: 'object',
		status: 201,
		requestBody: CreateInviteBodySchema,
		errors: [400, 403, 409]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/invites/{id}',
		summary: 'Revoke an invite.',
		response: 'empty',
		errors: [403, 404]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/invites/{id}/resend',
		summary:
			'Re-send an invite. Issues a replacement and revokes the original, so the previous link stops working.',
		response: 'object',
		status: 201,
		errors: [403, 404, 409]
	},
	{
		method: 'GET',
		path: '/orgs/{orgId}/compute',
		summary: 'Org compute-server overrides and the shared catalog.',
		internal: true,
		response: 'object',
		errors: [403]
	},
	{
		method: 'PATCH',
		path: '/orgs/{orgId}/compute',
		summary: 'Replace the org compute-server overrides.',
		internal: true,
		response: 'empty',
		requestBody: OrgComputePatchBodySchema,
		errors: [400, 403]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/assets/{kind}',
		summary: 'Upload an org branding asset.',
		internal: true,
		response: 'object',
		multipart: [{ field: 'image', required: true, description: 'PNG, JPEG, WebP, GIF or SVG.' }],
		errors: [400, 403, 404]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/assets/{kind}',
		summary: 'Remove an org branding asset.',
		internal: true,
		response: 'empty',
		errors: [403, 404]
	},

	// ==========================================================================
	// Compute
	// ==========================================================================
	//
	// Internal: accepts a remote `definitionUrl` and the anonymous share-token
	// flow, neither part of the public contract. Public callers solve through
	// `/definitions/{guid}/solve`.
	{
		method: 'POST',
		path: '/compute',
		summary: 'Generic solve, including remote definition URLs and share-token access.',
		internal: true,
		response: 'object',
		errors: solveErrors
	},
	{
		method: 'POST',
		path: '/compute/schema',
		summary: 'Extract UI schemas from an uploaded file before it becomes a definition.',
		internal: true,
		response: 'object',
		multipart: [{ field: 'file', required: true, description: 'The `.gh` or `.ghx` file.' }],
		query: [
			{ name: 'projectId', description: 'Project the file will belong to.' },
			{ name: 'computeServerId', description: 'Pin to a compute server.' }
		],
		errors: [400, 403, 422, 503]
	}
];

/** `/definitions/{guid}` → the SvelteKit directory form `definitions/[guid]`. */
export function toRoutePath(openApiPath: string): string {
	return openApiPath.replace(/^\//, '').replace(/\{(\w+)\}/g, '[$1]');
}

export function endpointKey(method: HttpMethod, path: string): string {
	return `${method} ${path}`;
}
