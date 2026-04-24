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
	/** Unauthenticated visitor. Only passes on `public` + `allowAnonymous`. */
	anonymous?: boolean;
}

export function canView(input: ProjectAccessInput): boolean {
	const { project, member, orgMember } = input;
	if (!project) return false;

	if (project.visibility === 'private') {
		return member !== null;
	}
	if (project.visibility === 'org') {
		return orgMember !== null;
	}
	if (project.visibility === 'public') {
		if (input.anonymous) return Boolean(project.allowAnonymous);
		return true;
	}
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
