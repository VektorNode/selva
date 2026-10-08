/**
 * The v1 contract as data: one entry per method+path, naming its body validator,
 * response shape, and whether it's public or internal.
 *
 * Both the OpenAPI generator and the conformance test read this file. The test
 * walks `routes/api/v1/**` against this table and fails if either side has an
 * entry the other doesn't — a route with no registry entry is undocumented, a
 * registry entry with no route is a spec promising something that 404s.
 *
 * Request schemas are Zod values imported from `@selvajs/server/api`, not
 * transcribed, so a renamed field changes the spec on the next generate
 * instead of silently disagreeing with the validator.
 */

import {
	type Endpoint,
	type HttpMethod,
	SolveBodySchema,
	CreateProjectBodySchema,
	UpdateProjectBodySchema,
	AddProjectMemberBodySchema,
	UpdateProjectMemberBodySchema,
	CreateInviteBodySchema,
	UpdateOrgMemberBodySchema,
	OrgComputePatchBodySchema,
	CreateApiTokenBodySchema
} from '@selvajs/server/api';

export type { Endpoint, HttpMethod };

const solveErrors = [400, 401, 404, 429, 503];

export const V1_ENDPOINTS: Endpoint[] = [
	{
		method: 'GET',
		path: '/openapi.json',
		scope: 'read',
		summary: 'This document, as JSON.',
		response: 'object'
	},

	// ==========================================================================
	// Me
	// ==========================================================================
	{
		method: 'GET',
		path: '/me',
		scope: 'read',
		summary: 'The calling identity, its acting org, and its effective permissions.',
		response: 'object'
	},
	{
		method: 'PUT',
		path: '/me/starred/{guid}',
		scope: 'write',
		summary: 'Star a definition. Idempotent.',
		response: 'empty',
		errors: [404]
	},
	{
		method: 'DELETE',
		path: '/me/starred/{guid}',
		scope: 'write',
		summary: 'Unstar a definition. Idempotent.',
		response: 'empty'
	},

	// ==========================================================================
	// Definitions
	// ==========================================================================
	{
		method: 'GET',
		path: '/definitions',
		scope: 'read',
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
		scope: 'write',
		idempotent: true,
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
		scope: 'read',
		summary: 'Definition record plus its live and draft version summaries.',
		response: 'object',
		errors: [404]
	},
	{
		method: 'PATCH',
		path: '/definitions/{guid}',
		scope: 'write',
		summary: 'Update definition metadata.',
		response: 'empty',
		errors: [400, 404]
	},
	{
		method: 'DELETE',
		path: '/definitions/{guid}',
		scope: 'write',
		summary: 'Soft-delete a definition.',
		response: 'empty',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/solve',
		scope: 'solve',
		idempotent: true,
		summary: 'Solve a definition. The primary action of the API.',
		response: 'object',
		requestBody: SolveBodySchema,
		errors: solveErrors
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/schema',
		scope: 'read',
		summary: "The live version's UI schema. 404 when nothing is published.",
		response: 'object',
		errors: [404]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/versions',
		scope: 'read',
		summary: 'List versions, newest first.',
		response: 'collection',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/versions',
		scope: 'write',
		idempotent: true,
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
		scope: 'read',
		summary: 'One version, without its cached schema.',
		response: 'object',
		errors: [404]
	},
	{
		method: 'DELETE',
		path: '/definitions/{guid}/versions/{versionId}',
		scope: 'write',
		summary: 'Delete a version. 409 when it is the live or draft pointer.',
		response: 'empty',
		errors: [404, 409]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/versions/{versionId}/schema',
		scope: 'read',
		summary: "That version's cached UI schema. No compute round-trip.",
		response: 'object',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/publish',
		scope: 'write',
		summary: 'Promote a version to live.',
		response: 'object',
		errors: [400, 404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/image',
		scope: 'write',
		summary: 'Upload a cover image.',
		response: 'object',
		multipart: [{ field: 'image', required: true, description: 'PNG, JPEG, WebP or GIF.' }],
		errors: [400, 404]
	},
	{
		method: 'GET',
		path: '/definitions/{guid}/share-links',
		scope: 'read',
		summary: 'List share links. 404 when sharing is disabled on the instance.',
		response: 'collection',
		errors: [404]
	},
	{
		method: 'POST',
		path: '/definitions/{guid}/share-links',
		scope: 'write',
		idempotent: true,
		summary: 'Create a share link. The raw token is returned once and never again.',
		response: 'object',
		status: 201,
		errors: [400, 404]
	},
	{
		method: 'DELETE',
		path: '/definitions/{guid}/share-links/{linkId}',
		scope: 'write',
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
		scope: 'read',
		summary: 'List projects the caller can view.',
		response: 'collection'
	},
	{
		method: 'POST',
		path: '/projects',
		scope: 'write',
		idempotent: true,
		summary: 'Create a project.',
		response: 'object',
		status: 201,
		requestBody: CreateProjectBodySchema,
		errors: [400, 403, 409]
	},
	{
		method: 'GET',
		path: '/projects/{id}',
		scope: 'read',
		summary: "Project record plus the caller's effective role and capabilities.",
		response: 'object',
		errors: [404]
	},
	{
		method: 'PATCH',
		path: '/projects/{id}',
		scope: 'write',
		summary: 'Update project settings. Owner-only.',
		response: 'empty',
		requestBody: UpdateProjectBodySchema,
		errors: [400, 403, 404, 409]
	},
	{
		method: 'DELETE',
		path: '/projects/{id}',
		scope: 'write',
		summary: 'Delete a project.',
		response: 'empty',
		errors: [403, 404]
	},
	{
		method: 'GET',
		path: '/projects/{id}/members',
		scope: 'read',
		summary: 'List project members.',
		response: 'collection',
		errors: [403, 404]
	},
	{
		method: 'POST',
		path: '/projects/{id}/members',
		scope: 'write',
		summary: 'Add a member. The target must already belong to the org.',
		response: 'object',
		status: 201,
		requestBody: AddProjectMemberBodySchema,
		errors: [400, 403, 404]
	},
	{
		method: 'PATCH',
		path: '/projects/{id}/members/{userId}',
		scope: 'write',
		summary: 'Change a member role.',
		response: 'empty',
		requestBody: UpdateProjectMemberBodySchema,
		errors: [400, 403, 404, 409]
	},
	{
		method: 'DELETE',
		path: '/projects/{id}/members/{userId}',
		scope: 'write',
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
		scope: 'write',
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
		scope: 'read',
		summary: "Org record. The org must be the caller's acting org.",
		response: 'object',
		errors: [403, 404]
	},
	{
		method: 'GET',
		path: '/orgs/{orgId}/members',
		scope: 'read',
		summary: 'List org members.',
		response: 'collection',
		errors: [403]
	},
	{
		method: 'PATCH',
		path: '/orgs/{orgId}/members/{userId}',
		scope: 'write',
		summary: 'Change an org role or permission set. The sole owner cannot be demoted.',
		response: 'empty',
		requestBody: UpdateOrgMemberBodySchema,
		errors: [400, 403, 404, 409]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/members/{userId}',
		scope: 'write',
		summary: 'Remove an org member. The sole owner cannot be removed.',
		response: 'empty',
		errors: [403, 404, 409]
	},
	{
		method: 'GET',
		path: '/orgs/{orgId}/invites',
		scope: 'read',
		summary: 'List pending invites.',
		response: 'collection',
		errors: [403]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/invites',
		scope: 'write',
		summary: 'Invite someone to the org. The accept URL is returned once.',
		response: 'object',
		status: 201,
		requestBody: CreateInviteBodySchema,
		errors: [400, 403, 409]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/invites/{id}',
		scope: 'write',
		summary: 'Revoke an invite.',
		response: 'empty',
		errors: [403, 404]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/invites/{id}/resend',
		scope: 'write',
		summary:
			'Re-send an invite. Issues a replacement and revokes the original, so the previous link stops working.',
		response: 'object',
		status: 201,
		errors: [403, 404, 409]
	},
	// Internal and session-only: a key can never manage keys.
	{
		method: 'GET',
		path: '/orgs/{orgId}/tokens',
		scope: 'read',
		summary: 'Your API tokens in this org, revoked and expired included.',
		internal: true,
		response: 'collection',
		query: [
			{ name: 'all', description: "`true` for every member's tokens. Needs `manage_org_members`." }
		],
		errors: [403, 503]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/tokens',
		scope: 'write',
		summary: 'Create an API token acting as you. The raw key is returned once, as `secret`.',
		internal: true,
		response: 'object',
		status: 201,
		requestBody: CreateApiTokenBodySchema,
		errors: [400, 403, 503]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/tokens/{tokenId}',
		scope: 'write',
		summary: 'Revoke an API token: your own, or any in the org with `manage_org_members`.',
		internal: true,
		response: 'empty',
		errors: [403, 404, 503]
	},
	{
		method: 'GET',
		path: '/orgs/{orgId}/compute',
		scope: 'read',
		summary: 'Org compute-server overrides and the shared catalog.',
		internal: true,
		response: 'object',
		errors: [403]
	},
	{
		method: 'PATCH',
		path: '/orgs/{orgId}/compute',
		scope: 'write',
		summary: 'Replace the org compute-server overrides.',
		internal: true,
		response: 'empty',
		requestBody: OrgComputePatchBodySchema,
		errors: [400, 403]
	},
	{
		method: 'POST',
		path: '/orgs/{orgId}/assets/{kind}',
		scope: 'write',
		summary: 'Upload an org branding asset.',
		internal: true,
		response: 'object',
		multipart: [{ field: 'image', required: true, description: 'PNG, JPEG, WebP, GIF or SVG.' }],
		errors: [400, 403, 404]
	},
	{
		method: 'DELETE',
		path: '/orgs/{orgId}/assets/{kind}',
		scope: 'write',
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
		scope: 'solve',
		summary: 'Generic solve, including remote definition URLs and share-token access.',
		internal: true,
		response: 'object',
		errors: solveErrors
	},
	{
		method: 'POST',
		path: '/compute/schema',
		scope: 'write',
		summary: 'Extract UI schemas from an uploaded file before it becomes a definition.',
		internal: true,
		response: 'object',
		multipart: [{ field: 'file', required: true, description: 'The `.gh` or `.ghx` file.' }],
		query: [
			{ name: 'projectId', description: 'Project the file will belong to.' },
			{ name: 'computeServerId', description: 'Pin to a compute server.' }
		],
		errors: [400, 403, 422, 503]
	},

	// ==========================================================================
	// Live solve events
	// ==========================================================================
	//
	// Internal: the browser's live channel and the plugin's callback into it. Both
	// are shaped by the Selva plugin and web app, not by the public contract.
	{
		method: 'GET',
		path: '/solve-events',
		scope: 'read',
		summary: "The tab's live event stream (SSE). Solves that name its `streamId` report here.",
		internal: true,
		response: 'object',
		query: [{ name: 'streamId', description: 'Minted by the tab, 16-64 URL-safe characters.' }],
		errors: [400, 401, 409]
	},
	{
		method: 'POST',
		path: '/solve-events/{solveId}',
		scope: 'write',
		summary: "The plugin's callback from inside a Compute solve. The reply carries `abort`.",
		internal: true,
		response: 'object',
		errors: [400, 401, 410]
	},
	{
		method: 'POST',
		path: '/solve/{solveId}/cancel',
		scope: 'solve',
		summary: 'Ask a running solve to abort. Cooperative: it stops at the next component.',
		internal: true,
		response: 'empty',
		errors: [401, 404]
	}
];

/** `/definitions/{guid}` → the SvelteKit directory form `definitions/[guid]`. */
export function toRoutePath(openApiPath: string): string {
	return openApiPath.replace(/^\//, '').replace(/\{(\w+)\}/g, '[$1]');
}

export function endpointKey(method: HttpMethod, path: string): string {
	return `${method} ${path}`;
}
