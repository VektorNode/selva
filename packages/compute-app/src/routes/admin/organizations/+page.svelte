<script lang="ts">
	import { Card, DataTable, EmptyState, SectionHeader } from '@selvajs/ui';
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
				<DataTable
					rows={data.orgs}
					getKey={(o) => o.id}
					columns={[
						{ label: 'Organization' },
						{ label: 'Slug', width: '140px' },
						{ label: 'Members', width: '120px', align: 'right' },
						{ label: 'Created', width: '140px', align: 'right' }
					]}
				>
					{#snippet row(org)}
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{org.name}</p>
							<p class="text-muted-foreground truncate font-mono text-xs">{org.id}</p>
						</div>
						<code class="text-foreground font-mono text-xs">{org.slug}</code>
						<span class="text-right font-mono text-sm tabular-nums">{org.memberCount}</span>
						<span class="text-muted-foreground text-right text-xs">
							{new Date(org.createdAt).toLocaleDateString()}
						</span>
					{/snippet}
				</DataTable>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
