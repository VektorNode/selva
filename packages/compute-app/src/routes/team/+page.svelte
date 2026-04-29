<script lang="ts">
	import { Card, SectionHeader } from '@selvajs/ui';
	import { Users, FolderKanban, Building2 } from '@lucide/svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import type { Organization } from '@selvajs/platform';

	interface PageData {
		org: Organization | null;
		memberCount: number;
		projectCount: number;
	}
	let { data }: { data: PageData } = $props();

	const tiles = $derived([
		{
			href: '/team/members',
			icon: Users,
			value: data.memberCount,
			label: `Member${data.memberCount === 1 ? '' : 's'}`
		},
		{
			href: '/team/projects',
			icon: FolderKanban,
			value: data.projectCount,
			label: `Project${data.projectCount === 1 ? '' : 's'}`
		}
	]);
</script>

<svelte:head>
	<title>Team · Overview</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title={data.org ? data.org.name : 'No active organization'}
		description={data.org
			? `Workspace for ${data.org.name}. Manage members, projects, and team-wide settings.`
			: 'Switch to an organization from the user menu to see team details.'}
	/>

	{#if data.org}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each tiles as tile (tile.href)}
				<StatCard {...tile} />
			{/each}
		</div>

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-sm font-medium">
					<Building2 class="text-muted-foreground h-4 w-4" />
					Organization details
				</Card.Title>
			</Card.Header>
			<Card.Content>
				<dl class="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
					<dt class="text-muted-foreground">Name</dt>
					<dd>{data.org.name}</dd>

					<dt class="text-muted-foreground">Slug</dt>
					<dd><code class="font-mono text-xs">{data.org.slug}</code></dd>

					<dt class="text-muted-foreground">Org ID</dt>
					<dd><code class="text-muted-foreground font-mono text-xs">{data.org.id}</code></dd>

					<dt class="text-muted-foreground">Created</dt>
					<dd class="text-muted-foreground">
						{new Date(data.org.createdAt).toLocaleDateString()}
					</dd>
				</dl>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
