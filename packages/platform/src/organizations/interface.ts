import type { RequestContext } from '../context.js';
import type { ListOptions, Page } from '../pagination.js';
import type { Organization, OrgMember } from './types.js';
import type { OrgRole, OrgPermission } from './schemas.js';

/**
 * Organizations + org members. Tenancy boundary for everything else; reads and
 * writes scope by `ctx.actingOrgId`.
 */
export interface IOrgStore {
	// Organizations
	listOrgs(ctx: RequestContext, opts?: ListOptions): Promise<Page<Organization>>;
	getOrg(ctx: RequestContext, id: string): Promise<Organization | null>;
	getOrgBySlug(ctx: RequestContext, slug: string): Promise<Organization | null>;
	createOrg(ctx: RequestContext, org: Organization): Promise<void>;
	updateOrg(
		ctx: RequestContext,
		id: string,
		patch: Partial<Pick<Organization, 'name' | 'slug' | 'assets'>>
	): Promise<void>;
	/**
	 * Soft-deletes the org, cascading to org members, projects, and project
	 * members (definitions and share links cascade through project deletion).
	 * Invites and the org compute-server override are NOT cascaded — clean
	 * those up explicitly if needed.
	 */
	deleteOrg(ctx: RequestContext, id: string): Promise<void>;

	// Org members
	listOrgMembers(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<OrgMember>>;
	getOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<OrgMember | null>;
	/**
	 * Bulk counterpart to `getOrgMember`, for evaluating access rules over a
	 * list of orgs in one query. Keys are the requested `orgIds`; an org the
	 * user is not a member of maps to `null` rather than being absent.
	 */
	getOrgMembersFor(
		ctx: RequestContext,
		orgIds: readonly string[],
		userId: string
	): Promise<Map<string, OrgMember | null>>;
	/**
	 * Finds one org membership for the user, to resolve `actingOrgId` during
	 * request bootstrap without N+1-ing over `listOrgs`. Returns `null` when
	 * the user has no live membership (soft-deleted ones are excluded). If the
	 * user has multiple memberships, which one comes back is adapter-defined.
	 */
	findUserMembership(
		ctx: RequestContext,
		userId: string
	): Promise<{ org: Organization; member: OrgMember } | null>;
	addOrgMember(ctx: RequestContext, member: OrgMember): Promise<void>;
	updateOrgMemberRole(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		role: OrgRole
	): Promise<void>;
	/**
	 * Replaces the `OrgPermission` set without changing role. Use this for
	 * permission edits — round-tripping through remove + add would cascade
	 * the org-removal soft-delete into project memberships.
	 */
	updateOrgMemberPermissions(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		permissions: readonly OrgPermission[]
	): Promise<void>;
	removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void>;
}
