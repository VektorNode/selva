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
	 * Soft-delete the org. Cascades soft-delete to org members, projects in the
	 * org, and project members. Definitions and share links cascade through the
	 * project deletion. Invites and the org compute-server override are NOT
	 * cascaded — clean those up explicitly if needed.
	 */
	deleteOrg(ctx: RequestContext, id: string): Promise<void>;

	// Org members
	listOrgMembers(ctx: RequestContext, orgId: string, opts?: ListOptions): Promise<Page<OrgMember>>;
	getOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<OrgMember | null>;
	/**
	 * One user's membership row across many orgs, in a single query. The bulk
	 * counterpart to `getOrgMember`, for evaluating access rules over a list.
	 *
	 * Keys are the requested `orgIds`; an org the user is not a member of maps to
	 * `null` rather than being absent.
	 */
	getOrgMembersFor(
		ctx: RequestContext,
		orgIds: readonly string[],
		userId: string
	): Promise<Map<string, OrgMember | null>>;
	/**
	 * Find ONE org membership for the user. Used by the request-bootstrap
	 * path to resolve `actingOrgId` without N+1-ing over `listOrgs`.
	 *
	 * Returns `null` when the user has no live membership. When the user has
	 * multiple memberships (multi-tenant deployments), the choice between
	 * them is adapter-defined — single-tenant deployments have exactly one,
	 * and multi-tenant deployments will eventually use a URL prefix
	 * (`/o/{slug}/...`) to pick explicitly. Soft-deleted memberships are
	 * excluded.
	 *
	 * Both `org` and `member` are scoped by `ctx` (RLS-aware on Supabase).
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
	 * Replace `OrgPermission` set without changing role. Use this for
	 * permission edits — round-tripping through remove + add cascades the
	 * org-removal soft-delete into project memberships.
	 */
	updateOrgMemberPermissions(
		ctx: RequestContext,
		orgId: string,
		userId: string,
		permissions: readonly OrgPermission[]
	): Promise<void>;
	removeOrgMember(ctx: RequestContext, orgId: string, userId: string): Promise<void>;
}
