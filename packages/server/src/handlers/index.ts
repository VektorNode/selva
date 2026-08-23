/**
 * The API handlers themselves — the business logic behind each endpoint.
 *
 * A handler is `(req: ApiRequest) => Promise<ApiResponse | Response>` and names
 * no web framework: it reads params and body off `req`, reaches stores through
 * `req.deps`, and fails by throwing `ApiError`. A host binds one to a route by
 * building an `ApiRequest` and calling `runHandler` — see `api/README.md`.
 *
 * Handlers live here rather than in a host app so a second host implements the
 * same API by mounting these, not by reimplementing them and re-deriving the
 * gates, invariants, and status codes each one enforces.
 */

// Accessors for the host-composed services on `SelvaDeps`. Exported because a
// host's own handlers reach the same services through the same named failure.
export { definitionService, orgAssetService, tokenCodec } from './services.js';

export { getMe } from './me.js';
export { starDefinition, unstarDefinition } from './me.starred.js';
export { getOrg, listOrgMembers } from './orgs.js';
export { updateOrgMember, removeOrgMember } from './orgMembers.js';
export { reclaimProject } from './reclaim.js';
export { uploadOrgAsset, removeOrgAsset } from './orgAssets.js';
export { listShareLinks, createShareLink, revokeShareLink } from './shareLinks.js';
export {
	listDefinitions,
	createDefinition,
	getDefinition,
	deleteDefinition,
	updateDefinition,
	getDefinitionSchema,
	publishDefinition,
	uploadDefinitionImage
} from './definitions.js';
export {
	listVersions,
	uploadVersion,
	getVersion,
	deleteVersion,
	getVersionSchema
} from './definitionVersions.js';
export {
	listProjects,
	createProject,
	getProject,
	updateProject,
	deleteProject
} from './projects.js';
export {
	listProjectMembers,
	addProjectMember,
	updateProjectMemberRole,
	removeProjectMember
} from './projectMembers.js';
export { getOrgCompute, updateOrgCompute } from './orgCompute.js';
export { listInvites, createInvite, revokeInvite, resendInvite } from './invites.js';
