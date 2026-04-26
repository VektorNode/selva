<script lang="ts">
	import { PageHeader, PageContent, SubNav, type SubNavItem } from '@selvajs/shared';
	import { Gauge, Users, FolderKanban, Activity, Link2, SlidersHorizontal } from '@lucide/svelte';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	interface LayoutProps {
		data: {
			user?: { platformPermissions?: PlatformPermission[] } | null;
			ctx: { orgPermissions: OrgPermission[] } | null;
		};
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();

	const orgPerms = $derived<OrgPermission[]>(data.ctx?.orgPermissions ?? []);
	const can = (p: OrgPermission) => orgPerms.includes(p);

	const tabs = $derived(
		[
			{ href: '/team', label: 'General', icon: Gauge, show: true },
			{
				href: '/team/members',
				label: 'Members',
				icon: Users,
				match: 'prefix' as const,
				show: can('manage_org_members')
			},
			{
				href: '/team/projects',
				label: 'Projects',
				icon: FolderKanban,
				match: 'prefix' as const,
				show: can('manage_projects')
			},
			{
				href: '/team/activity',
				label: 'Activity',
				icon: Activity,
				match: 'prefix' as const,
				show: true
			},
			{
				href: '/team/shares',
				label: 'Share links',
				icon: Link2,
				match: 'prefix' as const,
				show: can('manage_definitions')
			},
			{
				href: '/team/settings',
				label: 'Settings',
				icon: SlidersHorizontal,
				match: 'prefix' as const,
				show: can('manage_org_members')
			}
		].filter((i) => i.show) satisfies (SubNavItem & { show: boolean })[]
	);
</script>

<PageHeader homeUrl="/app">
	{#snippet navItems()}
		<MainNav
			platformPermissions={data.user?.platformPermissions ?? []}
			orgPermissions={orgPerms}
		/>
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
	{/snippet}
	{#snippet subnav()}
		<SubNav items={tabs} />
	{/snippet}
</PageHeader>

<PageContent>
	{@render children?.()}
</PageContent>
