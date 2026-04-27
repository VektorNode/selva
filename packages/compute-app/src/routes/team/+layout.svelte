<script lang="ts">
	import { SideNav, type SideNavItem } from '@selvajs/ui';
	import { Gauge, Users, FolderKanban, Activity, Link2, SlidersHorizontal } from '@lucide/svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import type { Organization, OrgPermission } from '@selvajs/platform';

	interface LayoutProps {
		data: {
			ctx: { orgPermissions: OrgPermission[] } | null;
			org: Organization | null;
		};
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();

	const orgPerms = $derived<OrgPermission[]>(data.ctx?.orgPermissions ?? []);
	const can = (p: OrgPermission) => orgPerms.includes(p);

	const items = $derived(
		[
			{ href: '/team', label: 'General', icon: Gauge, show: true },
			{
				href: '/team/members',
				label: 'Members & roles',
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
		].filter((i) => i.show) satisfies (SideNavItem & { show: boolean })[]
	);

	function orgInitials(name: string): string {
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]!.toUpperCase())
			.join('');
	}
</script>

<AppHeader>
	{#snippet sidenav()}
		<SideNav {items} eyebrow="Organization">
			{#snippet header()}
				{#if data.org}
					<div
						class="border-border bg-accent/40 flex items-center gap-2 rounded-md border px-2.5 py-2"
					>
						<span
							class="bg-primary/15 text-primary flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[11px] font-semibold"
						>
							{orgInitials(data.org.name)}
						</span>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm leading-tight font-medium">{data.org.name}</p>
							<p class="text-muted-foreground truncate font-mono text-[10px]">{data.org.slug}</p>
						</div>
					</div>
				{/if}
			{/snippet}
		</SideNav>
	{/snippet}

	<div class="px-(--page-px) py-(--page-py)">
		{@render children?.()}
	</div>
</AppHeader>
