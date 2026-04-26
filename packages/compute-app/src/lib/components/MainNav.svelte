<script lang="ts">
	import { page } from '$app/state';
	import { LayoutGrid, GitBranch, Users, Shield } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	interface Props {
		platformPermissions?: PlatformPermission[];
		orgPermissions?: OrgPermission[];
	}

	let { platformPermissions = [], orgPermissions = [] }: Props = $props();

	const isPlatformAdmin = $derived(platformPermissions.includes('instance_admin'));

	// Visibility uses any platform-class permission for /admin (mirrors layout
	// gate). /team is visible to anyone with at least one org-admin perm.
	const ANY_PLATFORM_PERM: PlatformPermission[] = [
		'instance_admin',
		'manage_compute',
		'manage_instance_users',
		'manage_updates'
	];
	const ANY_ORG_ADMIN_PERM: OrgPermission[] = [
		'manage_org_members',
		'manage_org_compute',
		'manage_definitions',
		'manage_projects'
	];

	const showAdmin = $derived(
		isPlatformAdmin || ANY_PLATFORM_PERM.some((p) => platformPermissions.includes(p))
	);
	const showTeam = $derived(
		isPlatformAdmin || ANY_ORG_ADMIN_PERM.some((p) => orgPermissions.includes(p))
	);

	const items = $derived(
		[
			{
				href: '/app',
				label: 'Tools',
				icon: LayoutGrid as Component,
				show: true,
				match: 'exact' as const
			},
			{
				href: '/definitions',
				label: 'Definitions',
				icon: GitBranch as Component,
				show: true,
				match: 'prefix' as const
			},
			{
				href: '/team',
				label: 'Team',
				icon: Users as Component,
				show: showTeam,
				match: 'prefix' as const
			},
			{
				href: '/admin',
				label: 'Admin',
				icon: Shield as Component,
				show: showAdmin,
				match: 'prefix' as const
			}
		].filter((i) => i.show)
	);

	function isActive(item: (typeof items)[number]): boolean {
		const path = page.url.pathname;
		if (item.match === 'prefix') return path.startsWith(item.href);
		return path === item.href;
	}
</script>

{#each items as item (item.href)}
	{@const active = isActive(item)}
	{@const Icon = item.icon}
	<a
		href={item.href}
		class={[
			'h-8 px-2.5 gap-1.5 rounded-md flex items-center text-sm font-medium transition-colors',
			active
				? 'bg-accent text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
		].join(' ')}
	>
		<Icon class="h-3.5 w-3.5" />
		{item.label}
	</a>
{/each}
