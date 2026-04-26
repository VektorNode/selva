import type { PlatformPermission } from '../permissions/types.js';
import type { OrgPermission } from '../organizations/schemas.js';
import type { Project, ProjectMember } from '../projects/types.js';
import type { OrgMember } from '../organizations/types.js';
import type { DefinitionRecord } from '../definitions/types.js';

/**
 * Pure access-control rules — single source of truth for UI gating across
 * adapters. Mutating store methods MUST re-enforce the same predicate
 * independently (RLS in SQL, code in local/JSON).
 *
 * `instance_admin` bypass is NOT baked into rule bodies — wrap calls with
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
	platformPermissions: readonly PlatformPermission[];
	orgPermissions: readonly OrgPermission[];
	project: Project | null;
	member: ProjectMember | null;
	orgMember: OrgMember | null;
	/**
	 * `ALLOW_CROSS_ORG_PUBLIC` flag. When false, `public` visibility means
	 * "everyone in the parent org" rather than "everyone on the instance".
	 */
	allowCrossOrgPublic: boolean;
}

/**
 * Authenticated-user view rule. Anonymous access is delivered via share-link
 * tokens — the route resolves a valid token before this rule runs.
 */
export function canView(input: ProjectAccessInput): boolean {
	const { project, member, orgMember, allowCrossOrgPublic } = input;
	if (!project) return false;

	if (project.visibility === 'private') return member !== null;
	if (project.visibility === 'org') return orgMember !== null;
	if (project.visibility === 'public') return allowCrossOrgPublic ? true : orgMember !== null;
	return false;
}

/** Same as `canView` today — kept distinct for future cost gating. */
export function canSolve(input: ProjectAccessInput): boolean {
	return canView(input);
}

export function canEdit(input: ProjectAccessInput): boolean {
	const { member } = input;
	return member?.role === 'owner' || member?.role === 'editor';
}

export function canManage(input: ProjectAccessInput): boolean {
	return input.member?.role === 'owner';
}

export function canEditProjectSettings(input: ProjectAccessInput): boolean {
	return input.member?.role === 'owner';
}

export interface VisibilityChangeInput {
	platformPermissions: readonly PlatformPermission[];
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
	platformPermissions: readonly PlatformPermission[];
	project: Project | null;
	definition: DefinitionRecord | null;
	member: ProjectMember | null;
	userId: string;
}

/**
 * Project editor/owner can always edit (moderation). On commons projects
 * (`autoJoinOnUpload=true`) the definition owner can edit their own.
 */
export function canEditDefinition(input: DefinitionAccessInput): boolean {
	const { project, definition, member, userId } = input;
	if (!project || !definition) return false;

	if (member?.role === 'owner' || member?.role === 'editor') return true;
	if (project.autoJoinOnUpload && userId === definition.ownerId) return true;

	return false;
}

export interface ReclaimAccessInput {
	platformPermissions: readonly PlatformPermission[];
	project: Project | null;
	orgMember: OrgMember | null;
	/** `ctx.actingOrgId` — must match `project.orgId`. */
	actingOrgId: string | null;
}

/**
 * Org leadership escape hatch. Reclaim adds the actor as co-owner; it does
 * NOT demote the existing owner. Tenancy must match.
 */
export function canReclaim(input: ReclaimAccessInput): boolean {
	const { project, orgMember, actingOrgId } = input;
	if (!project || !actingOrgId) return false;
	if (actingOrgId !== project.orgId) return false;
	const role = orgMember?.role;
	return role === 'owner' || role === 'admin';
}

export interface CreateProjectAccessInput {
	platformPermissions: readonly PlatformPermission[];
	orgPermissions: readonly OrgPermission[];
	orgMember: OrgMember | null;
	actingOrgId: string | null;
	targetOrgId: string;
}

/**
 * Owner/admin can always create. A `member` needs `manage_projects` org
 * permission. Tenancy is enforced.
 */
export function canCreateProject(input: CreateProjectAccessInput): boolean {
	const { orgMember, orgPermissions, actingOrgId, targetOrgId } = input;
	if (actingOrgId !== targetOrgId) return false;
	const role = orgMember?.role;
	if (role === 'owner' || role === 'admin') return true;
	if (role === 'member' && orgPermissions.includes('manage_projects')) return true;
	return false;
}

/**
 * Pre-flight check for project-owner removal. Pure function over already-
 * loaded membership rows so route handlers can call it after `canManage`.
 *
 * - `ok` — proceed
 * - `sole_owner` — last owner; route surfaces 409 + suggests reclaim
 * - `needs_confirm` — owner-on-owner removal without `?confirm=true`
 *
 * Non-owner targets always return `ok`.
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
