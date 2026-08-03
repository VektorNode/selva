/**
 * Request-body validators for the v1 routes that take JSON.
 *
 * They live here rather than beside their handlers so the OpenAPI generator can
 * import them. A `+server.ts` imports `./$types`, which only resolves inside a
 * SvelteKit build — a spec script cannot load one. With the validators inline,
 * "the spec is derived from Zod" would have meant hand-transcribing them, which
 * is exactly the shape drift the spec is supposed to prevent: a renamed field
 * would validate one way and document another, and nothing would fail.
 *
 * **A JSON body accepted by a v1 route belongs in this file.** Adding one inline
 * is invisible to the generator, so the endpoint documents an empty body.
 * Multipart handlers are the exception — their fields are described in the spec
 * directly, since `FormData` has no Zod schema to derive from.
 */

import { z } from 'zod';
import {
	ProjectVisibilitySchema,
	ProjectRoleSchema,
	OrgRoleSchema,
	OrgPermissionSchema,
	PlatformPermissionSchema,
	ALL_ORG_PERMISSIONS,
	type OrgPermission
} from '@selvajs/platform';

// ============================================================================
// Definitions
// ============================================================================

export const SolveBodySchema = z.object({
	inputs: z.array(z.unknown()).default([]),
	values: z.record(z.string(), z.unknown()).default({}),
	channel: z.enum(['live', 'draft']).default('live'),
	versionId: z.string().optional(),
	/**
	 * Accepted only when it names this same definition. A caller pasting a body
	 * from `/api/v1/compute` should get a clear 400, not a silent solve of a
	 * different definition than the URL names.
	 */
	definitionUrl: z.string().optional()
});

// ============================================================================
// Projects
// ============================================================================

export const CreateProjectBodySchema = z.object({
	name: z.string().min(1, 'Project name is required').max(128).trim(),
	description: z.string().max(2000).optional(),
	visibility: ProjectVisibilitySchema.default('private'),
	autoJoinOnUpload: z.boolean().optional()
});

export const UpdateProjectBodySchema = z
	.object({
		name: z.string().min(1).max(128).trim(),
		description: z.string().max(2000).nullish(),
		visibility: ProjectVisibilitySchema,
		autoJoinOnUpload: z.boolean()
	})
	.partial();

export const AddProjectMemberBodySchema = z.object({
	userId: z.string().min(1, 'userId is required'),
	role: ProjectRoleSchema
});

export const UpdateProjectMemberBodySchema = z.object({ role: ProjectRoleSchema });

// ============================================================================
// Orgs
// ============================================================================

/**
 * Invites accept a flat `permissions[]` from the UI; platform-scope entries are
 * dropped downstream, since an invite only grants org rights.
 */
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

export const CreateInviteBodySchema = z.object({
	email: z.email('Valid email is required').transform((s) => s.toLowerCase().trim()),
	orgRole: OrgRoleSchema.default('member'),
	permissions: z.array(FlatPermissionSchema).default([])
});

/**
 * Replacement set for an org's own compute servers.
 *
 * `apiKey` is tri-state and the distinction is load-bearing: **omitted** keeps
 * the stored key, **null** clears it, and a string replaces it. `.optional()`
 * plus `.nullable()` — not `.nullish()` — because the two must stay
 * distinguishable after parsing; collapsing them would silently wipe a stored
 * credential on any request that left the field out.
 */
const IncomingComputeServerSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	serverUrl: z.string().min(1),
	apiKey: z.string().nullable().optional(),
	timeoutMs: z.number().optional(),
	retryCount: z.number().optional()
});

export const OrgComputePatchBodySchema = z.object({
	servers: z.array(IncomingComputeServerSchema),
	/**
	 * The org's default selection. May name any server visible to the org — a
	 * shared platform server, the global default, or one of its own. `null`
	 * clears the override; omitting it leaves the current one untouched.
	 */
	defaultServerId: z.string().nullable().optional()
});

export const UpdateOrgMemberBodySchema = z
	.object({
		role: OrgRoleSchema.optional(),
		permissions: z
			.array(z.enum(ALL_ORG_PERMISSIONS as readonly [OrgPermission, ...OrgPermission[]]))
			.optional()
	})
	.refine((b) => b.role !== undefined || b.permissions !== undefined, {
		message: 'Provide at least one of role, permissions'
	});
