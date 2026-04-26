<script lang="ts">
	import { PageHeader, PageContent, SubNav, type SubNavItem } from '@selvajs/shared';
	import { Gauge, Building2, Users, RotateCcw, Server, Settings, ScrollText } from '@lucide/svelte';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
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

	const adminTabs = $derived(
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
		].filter((i) => i.show) satisfies (SubNavItem & { show: boolean })[]
	);
</script>

<PageHeader homeUrl="/app">
	{#snippet navItems()}
		<MainNav
			platformPermissions={data.platformPermissions}
			orgPermissions={data.orgPermissions}
		/>
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
	{/snippet}
	{#snippet subnav()}
		<SubNav items={adminTabs} />
	{/snippet}
</PageHeader>

<PageContent>
	{@render children?.()}
</PageContent>
