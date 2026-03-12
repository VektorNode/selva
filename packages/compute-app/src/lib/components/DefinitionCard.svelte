<script lang="ts">
	import { Badge, Card } from '@selva/shared';

	interface Definition {
		filename: string;
		displayName: string;
		description?: string;
		category?: string;
		coverImage?: string;
		tags?: string[];
		originalFilename?: string;
	}

	let {
		definition,
		isLoading = false,
		onSelect
	}: { definition: Definition; isLoading?: boolean; onSelect: () => void } = $props();

	let imageError = $state(false);
</script>

{#snippet loadingOverlay()}
	{#if isLoading}
		<div class="absolute inset-0 flex items-center justify-center bg-black/50">
			<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
		</div>
	{/if}
{/snippet}

<button
	onclick={onSelect}
	disabled={isLoading}
	class="group h-full w-full overflow-hidden rounded-lg text-left transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
>
	<Card.Root class="flex h-full flex-col overflow-hidden pt-0">
		<div class="relative h-40 overflow-hidden rounded-t-lg">
			{#if definition.coverImage?.trim() && !imageError}
				<img
					src={definition.coverImage}
					alt={definition.displayName}
					class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
					onerror={() => (imageError = true)}
				/>
			{:else}
				<div class="bg-muted flex h-full items-center justify-center">
					<span class="text-muted-foreground text-sm">No preview</span>
				</div>
			{/if}
			{@render loadingOverlay()}
		</div>

		<Card.Header>
			<Card.Title class="line-clamp-2">{definition.displayName}</Card.Title>
			<Card.Description class="line-clamp-2">
				{definition.description ?? ''}
			</Card.Description>
			{#if definition.category}
				<Card.Action>
					<Badge variant="secondary">{definition.category}</Badge>
				</Card.Action>
			{/if}
		</Card.Header>

		<Card.Content class="flex grow flex-col justify-between gap-3">
			{#if definition.tags?.length}
				<div class="flex flex-wrap gap-1">
					{#each definition.tags.slice(0, 4) as tag (tag)}
						<Badge variant="secondary" class="text-xs">{tag}</Badge>
					{/each}
					{#if definition.tags.length > 4}
						<Badge variant="secondary" class="text-xs">+{definition.tags.length - 4}</Badge>
					{/if}
				</div>
			{/if}

			<p class="text-muted-foreground truncate text-xs">
				{definition.originalFilename ?? definition.filename}
			</p>
		</Card.Content>
	</Card.Root>
</button>
