<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import { Users, Server, LayoutDashboard, ArrowRight, GitCommit, Building2 } from '@lucide/svelte';
	import type { PlatformPermission } from '@selvajs/platform';

	interface PageData {
		stats: { users: number | null };
		platformPermissions: PlatformPermission[];
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const build = {
		hash: __GIT_SHORT_HASH__,
		fullHash: __GIT_HASH__,
		message: __GIT_MESSAGE__,
		date: __GIT_DATE__
	};

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
		description="At-a-glance health of this Selva instance — users, compute, and content."
	/>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
		{#each tiles as tile (tile.href)}
			{@const Icon = tile.icon}
			<a href={tile.href} class="block">
				<Card.Root class="hover:bg-accent/40 h-full transition-colors">
					<Card.Content class="flex items-center justify-between gap-4 pt-6">
						<div class="flex items-center gap-4">
							<div class="bg-accent text-accent-foreground rounded-md p-2.5">
								<Icon class="h-4 w-4" />
							</div>
							<div>
								<p class="text-lg leading-tight font-semibold">{tile.value}</p>
								<p class="text-muted-foreground text-xs">{tile.label}</p>
							</div>
						</div>
						<ArrowRight class="text-muted-foreground h-4 w-4 shrink-0" />
					</Card.Content>
				</Card.Root>
			</a>
		{/each}
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-sm font-medium">
				<GitCommit class="text-muted-foreground h-4 w-4" />
				Web app build
			</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<code class="text-foreground font-mono text-xs" title={build.fullHash}>{build.hash}</code>
				<span class="text-muted-foreground text-xs">{build.message}</span>
				<span class="text-muted-foreground text-xs">{build.date}</span>
			</div>
		</Card.Content>
	</Card.Root>
</div>
