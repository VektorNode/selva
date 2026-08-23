<script lang="ts">
	import { page } from '$app/state';
	import { Card, SectionHeader } from '@selvajs/ui';
	import { Users, Server, LayoutDashboard, Package, Building2 } from '@lucide/svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import AssetUpload from '$lib/components/AssetUpload.svelte';
	import type { PlatformPermission } from '@selvajs/platform';

	const brandName = $derived(page.data.branding.name);

	interface PageData {
		stats: { users: number | null };
		platformPermissions: PlatformPermission[];
		version: string;
		org: { id: string; name: string; assets: Record<string, string> } | null;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const can = (p: PlatformPermission) =>
		data.platformPermissions.includes('instance_admin') || data.platformPermissions.includes(p);

	const tiles = $derived(
		[
			{
				href: '/admin/users',
				icon: Users,
				value: data.stats.users ?? '—',
				label:
					data.stats.users === null
						? 'User store unavailable'
						: `User${data.stats.users === 1 ? '' : 's'}`,
				show: can('manage_instance_users')
			},
			{
				href: '/admin/organizations',
				icon: Building2,
				value: 'Organizations',
				label: 'All orgs on this instance',
				show: can('instance_admin')
			},
			{
				href: '/admin/compute',
				icon: Server,
				value: 'Compute',
				label: 'Servers, status & config',
				show: can('manage_compute')
			},
			{
				href: '/projects',
				icon: LayoutDashboard,
				value: 'Content',
				label: 'Definitions & projects',
				show: can('instance_admin')
			}
		].filter((t) => t.show)
	);
</script>

<svelte:head>
	<title>Admin · General</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="General"
		description="At-a-glance health of this {brandName} instance — users, compute, and content."
	/>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each tiles as tile (tile.href)}
			<StatCard {...tile} />
		{/each}
	</div>

	{#if data.org}
		<AssetUpload
			orgId={data.org.id}
			kind="logo"
			url={data.org.assets.logo ?? null}
			title="Company logo"
			description="Upload a logo to reuse across {brandName}. Shown in the viewer header; more surfaces will pick it up."
		/>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-sm font-medium">
				<Package class="text-muted-foreground h-4 w-4" />
				Installed version
			</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<code class="text-foreground font-mono text-xs">@selvajs/selva</code>
				<span class="text-muted-foreground text-xs">v{data.version}</span>
			</div>
		</Card.Content>
	</Card.Root>
</div>
