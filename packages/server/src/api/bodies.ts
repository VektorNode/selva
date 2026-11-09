/**
 * Request-body validators for the API routes that take JSON.
 *
 * They live apart from their handlers so a spec generator can import them
 * without loading a host's route module — in Selva's case a `+server.ts` imports
 * `./$types`, which only resolves inside a SvelteKit build.
 *
 * **A JSON body accepted by an API route belongs in this file.** Adding one
 * inline is invisible to the generator, so the endpoint documents an empty body.
 * Multipart handlers are the exception — `FormData` has no Zod schema to derive
 * from, so their fields are described in the spec directly.
 */

import { z } from 'zod';
import {
	ProjectVisibilitySchema,
	ProjectRoleSchema,
	OrgRoleSchema,
	OrgPermissionSchema,
	PlatformPermissionSchema,
	ApiScopeStringSchema,
	API_TOKEN_LIFETIME_DAYS,
	CreateShareLinkInputSchema,
	DefinitionChannelSchema,
	PublishVersionInputSchema,
	UpdateMetadataInputSchema
} from '@selvajs/platform';

// ============================================================================
// Definitions
// ============================================================================

export const SolveModeSchema = z.enum(['preview', 'full']);

export const SolveBodySchema = z.object({
	/** Ignored: the solve reads the inputs from the version's stored schema. */
	inputs: z.array(z.unknown()).optional().meta({ deprecated: true }),
	values: z.record(z.string(), z.unknown()).default({}),
	channel: DefinitionChannelSchema.default('live'),
	versionId: z.string().optional(),
	/** Must name this same definition, or the route 400s instead of solving a different one. */
	definitionUrl: z.string().optional(),
	/**
	 * `preview` skips the files only a Download output needs, when the definition turns
	 * `previewSolves` on; the response's outcome lists them as `deferred`. A `full` solve of the
	 * same values makes them.
	 */
	mode: SolveModeSchema.default('full')
});

export const UpdateDefinitionBodySchema = UpdateMetadataInputSchema;
export const PublishVersionBodySchema = PublishVersionInputSchema;
export const CreateShareLinkBodySchema = CreateShareLinkInputSchema;

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

/** Platform-scope entries are dropped downstream — an invite only grants org rights. */
const FlatPermissionSchema = z.union([PlatformPermissionSchema, OrgPermissionSchema]);

export const CreateInviteBodySchema = z.object({
	email: z.email('Valid email is required').transform((s) => s.toLowerCase().trim()),
	orgRole: OrgRoleSchema.default('member'),
	permissions: z.array(FlatPermissionSchema).default([])
});

/**
 * `apiKey` is tri-state: **omitted** keeps the stored key, **null** clears it, a
 * string replaces it. `.optional().nullable()` — not `.nullish()` — because the
 * two must stay distinguishable after parsing, or a request that just omits the
 * field would silently wipe the stored credential.
 */
const IncomingComputeServerSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	serverUrl: z.string().min(1),
	apiKey: z.string().nullable().optional()
});

export const OrgComputePatchBodySchema = z.object({
	servers: z.array(IncomingComputeServerSchema),
	/** May name any server visible to the org. `null` clears the override; omitted leaves it untouched. */
	defaultServerId: z.string().nullable().optional()
});

export const UpdateOrgMemberBodySchema = z
	.object({
		role: OrgRoleSchema.optional(),
		permissions: z.array(OrgPermissionSchema).optional()
	})
	.refine((b) => b.role !== undefined || b.permissions !== undefined, {
		message: 'Provide at least one of role, permissions'
	});

// ============================================================================
// API tokens
// ============================================================================

export const CreateApiTokenBodySchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(100),
	scopes: z.array(ApiScopeStringSchema).min(1, 'Pick at least one scope').max(20),
	expiresInDays: z.union(API_TOKEN_LIFETIME_DAYS.map((d) => z.literal(d)))
});
