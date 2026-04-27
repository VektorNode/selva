<script lang="ts">
	import { PageHeader, SideNav, type SideNavItem } from '@selvajs/shared';
	import { Gauge, Building2, Users, RotateCcw, Server, Settings, ScrollText } from '@lucide/svelte';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	interface LayoutData {
		platformPermissions: PlatformPermission[];
		orgPermissions: OrgPermission[];
	}
	interface LayoutProps {
		data: LayoutData;
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();

	// Client-side gate — `instance_admin` implies every org perm.
	const can = (p: PlatformPermission | OrgPermission) => {
		if (data.platformPermissions.includes('instance_admin')) return true;
		if (p === 'instance_admin') return false;
		return data.orgPermissions.includes(p as OrgPermission);
	};

	const items = $derived(
		[
			{ href: '/admin', label: 'General', icon: Gauge, show: true },
			{
				href: '/admin/organizations',
				label: 'Organizations',
				icon: Building2,
				match: 'prefix' as const,
				show: can('instance_admin')
			},
			{
				href: '/admin/users',
				label: 'Users',
				icon: Users,
				match: 'prefix' as const,
				show: can('manage_instance_users')
			},
			{
				href: '/admin/reclaim',
				label: 'Reclaim',
				icon: RotateCcw,
				match: 'prefix' as const,
				show: can('instance_admin')
			},
			{
				href: '/admin/compute',
				label: 'Compute',
				icon: Server,
				match: 'prefix' as const,
				show: can('manage_compute')
			},
			{
				href: '/admin/system',
				label: 'System',
				icon: Settings,
				match: 'prefix' as const,
				show: can('instance_admin')
			},
			{
				href: '/admin/audit',
				label: 'Audit log',
				icon: ScrollText,
				match: 'prefix' as const,
				show: can('instance_admin')
			}
		].filter((i) => i.show) satisfies (SideNavItem & { show: boolean })[]
	);
</script>

<PageHeader homeUrl="/library">
	{#snippet navItems()}
		<MainNav />
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
		<SettingsMenu
			platformPermissions={data.platformPermissions}
			orgPermissions={data.orgPermissions}
		/>
	{/snippet}
</PageHeader>

<div class="flex h-[calc(100vh-3.5rem)] overflow-hidden">
	<SideNav {items} eyebrow="Platform" />

	<main class="flex-1 overflow-y-auto px-6 py-7">
		{@render children?.()}
	</main>
</div>
