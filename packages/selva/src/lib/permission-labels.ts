/**
 * One vocabulary for permissions and roles across every surface that shows them
 * — /admin/users, /team/members, project sharing.
 *
 * These render side by side (an admin filtering the instance list, then editing
 * the same person's org row), so a wording or casing split reads as two
 * different permissions rather than one seen twice.
 */

import type { OrgPermission, OrgRole, PlatformPermission } from '@selvajs/platform';

export type AnyPermission = PlatformPermission | OrgPermission;

export const PERMISSION_LABELS: Record<AnyPermission, string> = {
	instance_admin: 'Instance admin',
	manage_instance_users: 'Manage instance users',
	manage_compute: 'Manage compute',
	manage_updates: 'Manage updates',
	manage_org_members: 'Manage org members',
	manage_org_compute: 'Manage org compute',
	manage_definitions: 'Manage definitions',
	manage_projects: 'Manage projects'
};

export const PERMISSION_DESCRIPTIONS: Record<AnyPermission, string> = {
	instance_admin: 'Full access to every action on the instance.',
	manage_instance_users: 'Create, disable, and delete any user on the instance.',
	manage_compute: 'Configure the instance Rhino.Compute pool.',
	manage_updates: 'Run the application update script.',
	manage_org_members: 'Invite, remove, and change roles of org members.',
	manage_org_compute: "Configure this org's BYO compute server.",
	manage_definitions: 'Upload, edit, and delete any definition in the org.',
	manage_projects: 'Create, edit, and delete any project in the org.'
};

export const ROLE_TONE: Record<OrgRole, string> = {
	owner: 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5',
	admin: 'border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/5',
	member: 'border-border text-muted-foreground'
};

export const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member'];
