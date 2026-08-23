import type { PlatformPermission } from '../permissions/types.js';
import type { OrgPermission, OrgRole } from '../organizations/schemas.js';
import type { Project, ProjectMember } from '../projects/types.js';
import type { OrgMember } from '../organizations/types.js';
import type { DefinitionRecord } from '../definitions/types.js';
import type { PlatformProjectGrant } from '../platformProjects/types.js';

/**
 * Pure access-control rules — single source of truth for UI gating across
 * adapters. Mutating store methods MUST re-enforce the same predicate
 * independently (RLS in SQL, code in local/JSON).
 *
 * `instance_admin` bypass is not baked into rule bodies — wrap calls with
 * `withAdminBypass` at the call site.
 */

function isInstanceAdmin(platformPermissions: readonly PlatformPermission[]): boolean {
	return platformPermissions.includes('instance_admin');
}

export function withAdminBypass(
	platformPermissions: readonly PlatformPermission[],
	rule: () => boolean
): boolean {
	if (isInstanceAdmin(platformPermissions)) return true;
	return rule();
}

export interface ProjectAccessInput {
	orgPermissions: readonly OrgPermission[];
	platformPermissions: readonly PlatformPermission[];
	project: Project | null;
	member: ProjectMember | null;
	orgMember: OrgMember | null;
	/**
	 * `ALLOW_CROSS_ORG_PUBLIC` flag. When false, `public` visibility means
	 * "everyone in the parent org" rather than "everyone on the instance".
	 */
	allowCrossOrgPublic: boolean;
	/**
	 * `ENABLE_PLATFORM_PROJECTS` flag. When false, every rule treats a
	 * `platform`-visibility project as inaccessible — even for instance
	 * admins — so the feature can be hidden silently without deleting data.
	 */
	enablePlatformProjects: boolean;
	/** Grants for `platform`-visibility projects; empty for non-platform ones. */
	platformGrants: readonly PlatformProjectGrant[];
	/** `ctx.actingOrgId` — matches org grants on platform projects. */
	actingOrgId: string | null;
	/** `ctx.userId` — matches user grants on platform projects. */
	userId: string;
}

/**
 * Authenticated-user view rule. Anonymous access goes through share-link
 * tokens instead — the route resolves a valid token before this runs.
 *
 * Platform projects: `instance_admin` always passes; otherwise any grant
 * (view-only or canSolve) satisfies view access.
 */
export function canView(input: ProjectAccessInput): boolean {
	const {
		project,
		member,
		orgMember,
		allowCrossOrgPublic,
		enablePlatformProjects,
		platformPermissions,
		platformGrants,
		actingOrgId,
		userId
	} = input;
	if (!project) return false;

	if (project.visibility === 'platform') {
		if (!enablePlatformProjects) return false;
		if (isInstanceAdmin(platformPermissions)) return true;
		return platformGrants.some(
			(g) =>
				(g.granteeType === 'user' && g.granteeId === userId) ||
				(g.granteeType === 'org' && g.granteeId === actingOrgId)
		);
	}

	if (project.visibility === 'private') return member !== null;
	if (project.visibility === 'org') return orgMember !== null;
	if (project.visibility === 'public') return allowCrossOrgPublic ? true : orgMember !== null;
	return false;
}

/**
 * Non-platform projects: same as `canView` — kept as a separate function so
 * cost gating can diverge from view access later.
 *
 * Platform projects: `instance_admin` always passes; a view-only grant
 * satisfies `canView` but not `canSolve` — the grant needs `canSolve: true`.
 */
export function canSolve(input: ProjectAccessInput): boolean {
	const {
		project,
		enablePlatformProjects,
		platformPermissions,
		platformGrants,
		actingOrgId,
		userId
	} = input;
	if (!project) return false;

	if (project.visibility === 'platform') {
		if (!enablePlatformProjects) return false;
		if (isInstanceAdmin(platformPermissions)) return true;
		return platformGrants.some(
			(g) =>
				g.canSolve &&
				((g.granteeType === 'user' && g.granteeId === userId) ||
					(g.granteeType === 'org' && g.granteeId === actingOrgId))
		);
	}

	return canView(input);
}

/**
 * Platform projects: `instance_admin` only (they have no member rows).
 * All other visibilities: project owner/editor.
 */
export function canEdit(input: ProjectAccessInput): boolean {
	const { member, project, enablePlatformProjects, platformPermissions } = input;
	if (project?.visibility === 'platform') {
		if (!enablePlatformProjects) return false;
		return isInstanceAdmin(platformPermissions);
	}
	return member?.role === 'owner' || member?.role === 'editor';
}

/** Platform projects: `instance_admin` only. All other visibilities: project owner. */
export function canManage(input: ProjectAccessInput): boolean {
	if (input.project?.visibility === 'platform') {
		if (!input.enablePlatformProjects) return false;
		return isInstanceAdmin(input.platformPermissions);
	}
	return input.member?.role === 'owner';
}

/** Platform projects: `instance_admin` only. All other visibilities: project owner. */
export function canEditProjectSettings(input: ProjectAccessInput): boolean {
	if (input.project?.visibility === 'platform') {
		if (!input.enablePlatformProjects) return false;
		return isInstanceAdmin(input.platformPermissions);
	}
	return input.member?.role === 'owner';
}

export interface VisibilityChangeInput {
	orgMember: OrgMember | null;
}

/**
 * Authorization to flip a project to `public`. The `ALLOW_CROSS_ORG_PUBLIC`
 * flag only changes what `public` means post-flip; the flip itself is gated
 * by org owner/admin role.
 */
export function canChangeVisibilityToPublic(input: VisibilityChangeInput): boolean {
	const role = input.orgMember?.role;
	return role === 'owner' || role === 'admin';
}

export interface DefinitionAccessInput {
	project: Project | null;
	definition: DefinitionRecord | null;
	member: ProjectMember | null;
	/**
	 * The actor's membership in the project's parent org, used only by the
	 * commons branch below. `null` means "not a member of this org" — which on a
	 * commons project is what separates a current contributor from a departed
	 * one.
	 */
	orgMember: OrgMember | null;
	userId: string;
	platformPermissions: readonly PlatformPermission[];
	/**
	 * `ENABLE_PLATFORM_PROJECTS` flag. When false, definitions in
	 * platform-visibility projects are not editable by anyone, matching the
	 * other project rules.
	 */
	enablePlatformProjects: boolean;
}

/**
 * For platform projects: `instance_admin` only.
 * For all other projects: project editor/owner can always edit (moderation).
 * On commons projects (`autoJoinOnUpload=true`) the definition owner can edit
 * their own, as long as they still belong to the project's org.
 */
export function canEditDefinition(input: DefinitionAccessInput): boolean {
	const {
		project,
		definition,
		member,
		orgMember,
		userId,
		platformPermissions,
		enablePlatformProjects
	} = input;
	if (!project || !definition) return false;

	if (project.visibility === 'platform') {
		if (!enablePlatformProjects) return false;
		return isInstanceAdmin(platformPermissions);
	}

	if (member?.role === 'owner' || member?.role === 'editor') return true;

	// Commons grants edit on top of belonging, not instead of it. `ownerId` is
	// stamped at upload and never revisited, so without the org-membership test
	// a departed uploader keeps edit/delete/share-link authority on everything
	// they ever uploaded — and flipping `autoJoinOnUpload` on hands it back to
	// them retroactively, with no action taken against them.
	if (project.autoJoinOnUpload && userId === definition.ownerId && orgMember) return true;

	return false;
}

export interface ReclaimAccessInput {
	project: Project | null;
	orgMember: OrgMember | null;
	/** `ctx.actingOrgId` — must match `project.orgId`. */
	actingOrgId: string | null;
}

/**
 * Org leadership escape hatch: adds the actor as co-owner without demoting
 * the existing owner. Tenancy must match.
 *
 * Platform projects can't be reclaimed — `instance_admin` already has
 * management access to them.
 */
export function canReclaim(input: ReclaimAccessInput): boolean {
	const { project, orgMember, actingOrgId } = input;
	if (!project || !actingOrgId) return false;
	if (project.visibility === 'platform') return false;
	if (actingOrgId !== project.orgId) return false;
	const role = orgMember?.role;
	return role === 'owner' || role === 'admin';
}

export interface CreateProjectAccessInput {
	orgPermissions: readonly OrgPermission[];
	orgMember: OrgMember | null;
	actingOrgId: string | null;
	targetOrgId: string;
}

/**
 * Owner/admin can always create; a `member` needs `manage_projects` org
 * permission. Tenancy is enforced.
 *
 * Platform projects (`visibility: 'platform'`) go through the admin API,
 * gated on `instance_admin` — this rule isn't consulted for them.
 */
export function canCreateProject(input: CreateProjectAccessInput): boolean {
	const { orgMember, orgPermissions, actingOrgId, targetOrgId } = input;
	if (actingOrgId !== targetOrgId) return false;
	const role = orgMember?.role;
	if (role === 'owner' || role === 'admin') return true;
	if (role === 'member' && orgPermissions.includes('manage_projects')) return true;
	return false;
}

export interface OrgOwnerAuthorityInput {
	/** The acting user's own membership row, not the org's `ownerId` column. */
	actorMember: OrgMember | null;
	/** The role being granted, or the role the target already holds. */
	role: OrgRole;
}

/**
 * Whether the actor may hand out or take away org `owner`/`admin` standing (§3).
 *
 * Three routes decide this — inviting someone as owner/admin, changing an
 * existing member's role, and removing an owner — and all three had written it
 * out longhand. Two of them had drifted by the time the access audit found
 * them: the invite route let an admin mint an `owner` invite for themselves,
 * and DELETE let an admin remove an owner that PATCH would not let them demote.
 * They are one rule, so they read it from one place.
 *
 * Reads the actor's **membership row**. `Organization.ownerId` is a separate
 * field that can disagree with it — see the sole-`instance_admin` finding — and
 * is not authority for this decision.
 */
export function canChangeOrgRole(input: OrgOwnerAuthorityInput): boolean {
	if (input.role === 'member') return true;
	return input.actorMember?.role === 'owner';
}

/**
 * Pre-flight check for project-owner removal, run after `canManage`.
 *
 * - `ok` — proceed
 * - `sole_owner` — last owner; route surfaces 409 and suggests reclaim
 * - `needs_confirm` — owner-on-owner removal without `?confirm=true`
 */
export type OwnerRemovalCheck = 'ok' | 'sole_owner' | 'needs_confirm';

export interface OwnerRemovalInput {
	target: { role: 'owner' | 'editor' | 'viewer' };
	allMembers: readonly { role: 'owner' | 'editor' | 'viewer' }[];
	confirmed: boolean;
}

export function checkOwnerRemoval(input: OwnerRemovalInput): OwnerRemovalCheck {
	if (input.target.role !== 'owner') return 'ok';
	const ownerCount = input.allMembers.filter((m) => m.role === 'owner').length;
	if (ownerCount <= 1) return 'sole_owner';
	if (!input.confirmed) return 'needs_confirm';
	return 'ok';
}
