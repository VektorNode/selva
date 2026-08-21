/**
 * Re-export shell. The body schemas moved to `@selvajs/server/api` — they are
 * Zod values with no framework in them, and a host reimplementing these routes
 * has to accept the same bodies to be the same API.
 *
 * A new JSON body belongs in the package file, not here: `registry.ts` derives
 * the OpenAPI spec from these values, so one declared elsewhere documents an
 * empty body.
 */

export {
	SolveBodySchema,
	CreateProjectBodySchema,
	UpdateProjectBodySchema,
	AddProjectMemberBodySchema,
	UpdateProjectMemberBodySchema,
	CreateInviteBodySchema,
	OrgComputePatchBodySchema,
	UpdateOrgMemberBodySchema
} from '@selvajs/server/api';
