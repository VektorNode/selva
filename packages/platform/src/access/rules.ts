import type { PlatformPermission } from '../auth/types.js';
import type { OrgPermission } from '../organizations/schemas.js';
import type { Project, ProjectMember } from '../projects/types.js';
import type { OrgMember } from '../organizations/types.js';
import type { DefinitionRecord } from '../definitions/types.js';

/**
 * Pure access-control rules shared across every adapter. Adapters resolve
 * entities and call these rules; the rules do the logic. Single source of
 * truth prevents adapter drift on policy changes.
 *
 * These are UI-gating rules — every mutating store method MUST re-enforce
 * the same predicate independently (RLS in SQL, code in local/JSON).
 *
 * `instance_admin` bypass is NOT baked into rule bodies. Wrap calls with
 * `withAdminBypass` at the call site; the pure rules reason about normal
 * users only. The wrapper is the future audit-log hook point.
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
}

/**
 * User-based view rule. Anonymous access is delivered out-of-band via §7
 * share-link tokens — the route layer resolves a valid token before this
 * rule runs and skips it. This rule reasons about authenticated users only.
 */
export function canView(input: ProjectAccessInput): boolean {
	const { project, member, orgMember } = input;
	if (!project) return false;

	if (project.visibility === 'private') return member !== null;
	if (project.visibility === 'org') return orgMember !== null;
	if (project.visibility === 'public') return true;
	return false;
}

/**
 * Same body as `canView` today. Kept distinct so future cost gating (quotas,
 * rate limits) lands here without touching view semantics.
 */
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
	/** Resolved `ALLOW_CROSS_ORG_PUBLIC` platform flag. */
	allowCrossOrgPublic: boolean;
}

export function canChangeVisibilityToPublic(input: VisibilityChangeInput): boolean {
	if (!input.allowCrossOrgPublic) return false;
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
 * Project editor/owner always can (moderation). On commons projects
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
	/** `ctx.actingOrgId` — must match the project's `orgId` to reclaim. */
	actingOrgId: string | null;
}

/**
 * Org leadership escape hatch (§5 `canReclaim`). Reclaim adds the actor as a
 * co-owner; it does NOT demote the existing owner. Tenancy must match — an
 * admin in another org cannot reclaim across tenants.
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
	/** `ctx.actingOrgId` — must match the target org's `id`. */
	actingOrgId: string | null;
	targetOrgId: string;
}

/**
 * §5 `canCreateProject`. Owner/admin can always create; a `member` needs the
 * `manage_projects` org permission. Tenancy is enforced — an actor's
 * `actingOrgId` must match the target org.
 */
export function canCreateProject(input: CreateProjectAccessInput): boolean {
	const { orgMember, orgPermissions, actingOrgId, targetOrgId } = input;
	if (actingOrgId !== targetOrgId) return false;
	const role = orgMember?.role;
	if (role === 'owner' || role === 'admin') return true;
	if (role === 'member' && orgPermissions.includes('manage_projects')) return true;
	return false;
}
