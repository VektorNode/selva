<script lang="ts">
	import { SideNav, type SideNavItem } from '@selvajs/ui';
	import { Gauge, Building2, Folders, Users, Server, Settings, ScrollText } from '@lucide/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import type { OrgPermission, PlatformPermission, TenancyMode } from '@selvajs/platform';

	interface LayoutData {
		platformPermissions: PlatformPermission[];
		orgPermissions: OrgPermission[];
		auditAvailable: boolean;
		platformProjectsEnabled: boolean;
		tenancy: TenancyMode;
	}
	interface LayoutProps {
		data: LayoutData;
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();

	// Client-side gate — `instance_admin` implies every perm.
	const can = (p: PlatformPermission | OrgPermission) => {
		if (data.platformPermissions.includes('instance_admin')) return true;
		if (data.platformPermissions.includes(p as PlatformPermission)) return true;
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
				show: can('instance_admin') && data.tenancy !== 'single'
			},
			{
				href: '/admin/projects',
				label: 'Projects',
				icon: Folders,
				match: 'prefix' as const,
				show: can('instance_admin') && data.platformProjectsEnabled
			},
			{
				href: '/admin/users',
				label: 'Users',
				icon: Users,
				match: 'prefix' as const,
				show: can('manage_instance_users')
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
				show: can('manage_updates')
			},
			{
				href: '/admin/audit',
				label: 'Audit log',
				icon: ScrollText,
				match: 'prefix' as const,
				show: can('instance_admin') && data.auditAvailable
			}
		].filter((i) => i.show) satisfies (SideNavItem & { show: boolean })[]
	);
</script>

<AppHeader>
	{#snippet sidenav()}
		<SideNav {items} eyebrow="Platform" border={false} />
	{/snippet}

	<div class="px-(--page-px) py-(--page-py)">
		{@render children?.()}
	</div>
</AppHeader>
