import type { PlatformPermission } from '../auth/types.js';
import type { OrgPermission } from '../organizations/schemas.js';
import type { Project, ProjectMember } from '../projects/types.js';
import type { OrgMember } from '../organizations/types.js';

/**
 * Pure access-control rules shared across every adapter.
 *
 * Adapters do the data lookup (their strength) and call these rules with the
 * already-resolved entities. A single source of truth prevents two adapters
 * from drifting — e.g. one being more permissive than another after a policy
 * change. Each rule takes primitives only; no I/O, no adapter types.
 *
 * These are *UI-gating* rules only. The mutating store methods are the real
 * security boundary — they must re-enforce the same rules independently
 * (RLS in SQL, rules.json in Firestore, code in local/JSON).
 */

function isInstanceAdmin(platformPermissions: readonly PlatformPermission[]): boolean {
	return platformPermissions.includes('instance_admin');
}

function hasOrgPermission(
	orgPermissions: readonly OrgPermission[],
	permission: OrgPermission
): boolean {
	return orgPermissions.includes(permission);
}

export interface ProjectAccessInput {
	/** Caller's platform-scope permissions. */
	platformPermissions: readonly PlatformPermission[];
	/** Caller's org-scope permissions for the project's org. */
	orgPermissions: readonly OrgPermission[];
	/** The project being accessed. Null if not found. */
	project: Project | null;
	/** The caller's membership in that project. Null if not a member. */
	member: ProjectMember | null;
	/** The caller's membership in the parent org. Null if not a member. */
	orgMember: OrgMember | null;
}

/**
 * Can the caller invoke a solve on this project?
 * Today: any authenticated user — visibility is enforced at listing time.
 */
export function canSolve(_input: ProjectAccessInput): boolean {
	return true;
}

/**
 * Can the caller edit definitions in this project?
 * - instance_admin: always
 * - project owner / editor: always
 * - manage_definitions (org-scope) + public project + org member: yes
 */
export function canEdit(input: ProjectAccessInput): boolean {
	if (isInstanceAdmin(input.platformPermissions)) return true;
	const { member, project, orgMember, orgPermissions } = input;
	if (member?.role === 'owner' || member?.role === 'editor') return true;
	if (
		hasOrgPermission(orgPermissions, 'manage_definitions') &&
		project?.visibility === 'public' &&
		orgMember !== null
	) {
		return true;
	}
	return false;
}

/**
 * Can the caller manage project-level settings (members, deletion)?
 * - instance_admin: always
 * - project owner: yes
 */
export function canManage(input: ProjectAccessInput): boolean {
	if (isInstanceAdmin(input.platformPermissions)) return true;
	return input.member?.role === 'owner';
}

/**
 * Can the caller edit project settings (name, slug, description, visibility)?
 * - instance_admin: always
 * - project owner: yes
 * - manage_definitions (org-scope) + project editor: yes
 */
export function canEditProjectSettings(input: ProjectAccessInput): boolean {
	if (isInstanceAdmin(input.platformPermissions)) return true;
	const { member, orgPermissions } = input;
	if (member?.role === 'owner') return true;
	if (hasOrgPermission(orgPermissions, 'manage_definitions') && member?.role === 'editor')
		return true;
	return false;
}

export interface DefinitionAccessInput {
	/** Caller's platform-scope permissions. */
	platformPermissions: readonly PlatformPermission[];
	/** Caller's org-scope permissions for the definition's org. */
	orgPermissions: readonly OrgPermission[];
	/** The project the definition lives in. Null if not found. */
	project: Project | null;
	/** Membership record for the *subject* user (usually the caller). */
	member: ProjectMember | null;
	/** Id of the user whose access is being checked. */
	userId: string;
	/** Id of the user who owns the definition record. */
	definitionOwnerId: string;
}

/**
 * Can `userId` edit the definition owned by `definitionOwnerId` in `project`?
 *
 * - instance_admin: always
 * - public projects: only the definition owner
 * - org projects: definition owner, OR project owner/editor
 * - private projects: project owner/editor only
 */
export function canEditDefinition(input: DefinitionAccessInput): boolean {
	if (isInstanceAdmin(input.platformPermissions)) return true;
	const { project, member, userId, definitionOwnerId } = input;
	if (!project) return false;

	if (project.visibility === 'public') {
		return userId === definitionOwnerId;
	}
	if (project.visibility === 'org') {
		if (userId === definitionOwnerId) return true;
		return member?.role === 'owner' || member?.role === 'editor';
	}
	if (project.visibility === 'private') {
		return member?.role === 'owner' || member?.role === 'editor';
	}
	return false;
}
