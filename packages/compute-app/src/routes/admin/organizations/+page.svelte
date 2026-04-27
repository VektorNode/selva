<script lang="ts">
	import { Card, EmptyState, SectionHeader } from '@selvajs/ui';
	import { Building2 } from '@lucide/svelte';
	import type { OrgRow } from './+page.server';

	interface PageData {
		orgs: OrgRow[];
	}
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Admin · Organizations</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Organizations"
		description="Every organization on this instance — members, slug, and creation date."
	/>

	<Card.Root>
		<Card.Content class="pt-6">
			{#if data.orgs.length === 0}
				<EmptyState
					icon={Building2}
					title="No organizations"
					description="This instance has no organizations yet, or the data provider does not expose org listing."
				/>
			{:else}
				<div class="divide-y rounded-lg border">
					<div
						class="bg-muted/40 text-muted-foreground grid grid-cols-[1fr_140px_120px_140px] gap-4 px-4 py-2 text-xs font-medium tracking-wide uppercase"
					>
						<span>Organization</span>
						<span>Slug</span>
						<span class="text-right">Members</span>
						<span class="text-right">Created</span>
					</div>
					{#each data.orgs as org (org.id)}
						<div class="grid grid-cols-[1fr_140px_120px_140px] items-center gap-4 px-4 py-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{org.name}</p>
								<p class="text-muted-foreground truncate font-mono text-xs">{org.id}</p>
							</div>
							<code class="text-foreground font-mono text-xs">{org.slug}</code>
							<span class="text-right font-mono text-sm tabular-nums">{org.memberCount}</span>
							<span class="text-muted-foreground text-right text-xs">
								{new Date(org.createdAt).toLocaleDateString()}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
