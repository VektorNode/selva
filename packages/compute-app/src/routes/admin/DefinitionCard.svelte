<script lang="ts">
	import { Button, Card, Badge } from '@selva/shared';
	import { Pencil } from '@lucide/svelte';

	interface DefinitionConfig {
		displayName: string;
		description: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		file?: string;
	}

	interface Props {
		guid: string;
		config: DefinitionConfig;
		onEdit?: (guid: string) => void;
	}

	let { guid, config, onEdit }: Props = $props();
</script>

<Card.Root class="overflow-hidden pt-0">
	<!-- Cover image -->
	<div class="bg-muted h-32">
		{#if config.coverImage}
			<img
				src={config.coverImage}
				alt={config.displayName}
				class="h-full w-full object-cover"
			/>
		{/if}
	</div>

	<Card.Content class="p-4">
		<div class="mb-2 flex items-start justify-between">
			<div class="min-w-0 flex-1">
				<h4 class="line-clamp-1 text-sm font-semibold">{config.displayName || guid}</h4>
				<p class="text-muted-foreground mt-0.5 truncate text-xs">
					{config.file || 'No file'}
				</p>
			</div>
			<Button
				size="sm"
				variant="ghost"
				onclick={() => onEdit?.(guid)}
				class="ml-2 h-8 w-8 shrink-0 p-0"
			>
				<Pencil class="h-4 w-4" />
			</Button>
		</div>

		<p class="text-muted-foreground mb-3 line-clamp-2 text-xs">
			{config.description || 'No description'}
		</p>

		{#if config.category}
			<div class="mb-2">
				<Badge>{config.category}</Badge>
			</div>
		{/if}

		{#if config.tags && config.tags.length > 0}
			<div class="flex flex-wrap gap-1">
				{#each config.tags.slice(0, 3) as tag}
					<Badge variant="secondary">{tag}</Badge>
				{/each}
				{#if config.tags.length > 3}
					<span class="text-muted-foreground text-xs">+{config.tags.length - 3} more</span>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
