import { LayoutGrid, GitBranch, Users, Shield } from '@lucide/svelte';
import type { Component } from 'svelte';
import type { OrgPermission, PlatformPermission } from '@selvajs/platform';
import { ALL_ORG_PERMISSIONS, OPERATOR_PLATFORM_PERMISSIONS } from '@selvajs/platform';

export interface NavLink {
	href: string;
	label: string;
	description?: string;
	icon: Component;
	match: 'exact' | 'prefix';
}

// The desktop header and the phone menu both read these, so a link gated here can't show
// in one and not the other.

export function mainNavLinks(ctx?: {
	platformPermissions?: string[];
	orgPermissions?: string[];
}): NavLink[] {
	const canManageProjects =
		(ctx?.platformPermissions ?? []).includes('instance_admin') ||
		(ctx?.orgPermissions ?? []).some((p) => p === 'manage_definitions' || p === 'manage_projects');

	return [
		{ href: '/library', label: 'Library', icon: LayoutGrid, match: 'prefix' as const, show: true },
		{
			href: '/projects',
			label: 'Projects',
			icon: GitBranch,
			match: 'prefix' as const,
			show: canManageProjects
		}
	].filter((i) => i.show);
}

export function settingsLinks({
	platformPermissions = [],
	orgPermissions = [],
	mayHoldApiTokens = false
}: {
	platformPermissions?: PlatformPermission[];
	orgPermissions?: OrgPermission[];
	/** `/team/tokens` is the only `/team` page some API-token holders can use. */
	mayHoldApiTokens?: boolean;
}): NavLink[] {
	const isPlatformAdmin = platformPermissions.includes('instance_admin');
	// Derived from the schemas, never re-listed: a hand-copied array still type-checks after a
	// permission is added, and the link would silently stop appearing for whoever holds the new one.
	const showAdmin =
		isPlatformAdmin || OPERATOR_PLATFORM_PERMISSIONS.some((p) => platformPermissions.includes(p));
	const showTeam =
		isPlatformAdmin ||
		mayHoldApiTokens ||
		ALL_ORG_PERMISSIONS.some((p) => orgPermissions.includes(p));

	return [
		{
			href: '/team',
			label: 'Team',
			description: 'Members, projects, and org-wide settings',
			icon: Users,
			match: 'prefix' as const,
			show: showTeam
		},
		{
			href: '/admin',
			label: 'Admin',
			description: 'Platform configuration and instance settings',
			icon: Shield,
			match: 'prefix' as const,
			show: showAdmin
		}
	].filter((i) => i.show);
}

export function isActiveLink(link: NavLink, pathname: string): boolean {
	return link.match === 'prefix' ? pathname.startsWith(link.href) : pathname === link.href;
}
