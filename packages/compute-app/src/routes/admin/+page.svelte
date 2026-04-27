<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import {
		Users,
		Server,
		LayoutDashboard,
		ArrowRight,
		GitCommit,
		Building2,
		RotateCcw
	} from '@lucide/svelte';

	interface PageData {
		stats: { users: number | null };
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

	const tiles = $derived([
		{
			href: '/admin/users',
			icon: Users,
			value: data.stats.users ?? '—',
			label:
				data.stats.users === null
					? 'User store unavailable'
					: `User${data.stats.users === 1 ? '' : 's'}`
		},
		{
			href: '/admin/organizations',
			icon: Building2,
			value: 'Organizations',
			label: 'All orgs on this instance'
		},
		{
			href: '/admin/compute',
			icon: Server,
			value: 'Compute',
			label: 'Servers, status & config'
		},
		{
			href: '/admin/reclaim',
			icon: RotateCcw,
			value: 'Reclaim',
			label: 'Take ownership of any project'
		},
		{
			href: '/projects',
			icon: LayoutDashboard,
			value: 'Content',
			label: 'Definitions & projects'
		}
	]);
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
				<Card.Root class="h-full transition-colors hover:bg-accent/40">
					<Card.Content class="flex items-center justify-between gap-4 pt-6">
						<div class="flex items-center gap-4">
							<div class="rounded-md bg-accent p-2.5 text-accent-foreground">
								<Icon class="h-4 w-4" />
							</div>
							<div>
								<p class="text-lg font-semibold leading-tight">{tile.value}</p>
								<p class="text-xs text-muted-foreground">{tile.label}</p>
							</div>
						</div>
						<ArrowRight class="h-4 w-4 shrink-0 text-muted-foreground" />
					</Card.Content>
				</Card.Root>
			</a>
		{/each}
	</div>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-sm font-medium">
				<GitCommit class="h-4 w-4 text-muted-foreground" />
				Web app build
			</Card.Title>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<code class="font-mono text-xs text-foreground" title={build.fullHash}>{build.hash}</code>
				<span class="text-xs text-muted-foreground">{build.message}</span>
				<span class="text-xs text-muted-foreground">{build.date}</span>
			</div>
		</Card.Content>
	</Card.Root>
</div>
