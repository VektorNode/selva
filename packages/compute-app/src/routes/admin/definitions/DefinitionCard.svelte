<script lang="ts">
	import { Button, Card, Badge } from 'selva-shared';
	import { Pencil, Lock, Globe, Users } from '@lucide/svelte';
	import type { ProjectVisibility } from '@selva/platform';

	interface DefinitionConfig {
		displayName: string;
		description: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		file?: string;
		originalFilename?: string;
	}

	interface Props {
		guid: string;
		config: DefinitionConfig;
		projectName?: string;
		projectVisibility?: ProjectVisibility;
		ownerId?: string;
		onEdit?: (guid: string) => void;
	}

	let { guid, config, projectName, projectVisibility, ownerId, onEdit }: Props = $props();

	const visibilityIcon = {
		private: { icon: Lock, label: 'Private', color: 'text-red-500' },
		org: { icon: Users, label: 'Organization', color: 'text-blue-500' },
		public: { icon: Globe, label: 'Public', color: 'text-green-500' }
	} as const;
</script>

<Card.Root class="overflow-hidden pt-0">
	<!-- Cover image -->
	<div class="bg-muted h-32">
		{#if config.coverImage}
			<img src={config.coverImage} alt={config.displayName} class="h-full w-full object-cover" />
		{/if}
	</div>

	<Card.Content class="p-4">
		<div class="mb-2 flex items-start justify-between">
			<div class="min-w-0 flex-1">
				<h4 class="line-clamp-1 text-sm font-semibold">{config.displayName || guid}</h4>
				<p class="text-muted-foreground mt-0.5 truncate text-xs">
					{config.originalFilename || config.file || 'No file'}
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

		<!-- Project & visibility info -->
		<div class="mb-3 flex items-center gap-2">
			{#if projectName}
				<span class="text-muted-foreground text-xs font-medium">{projectName}</span>
			{/if}
			{#if projectVisibility}
				{@const vis = visibilityIcon[projectVisibility]}
				<vis.icon class="h-3.5 w-3.5 {vis.color}" title={vis.label} />
			{/if}
			{#if ownerId}
				<span class="text-muted-foreground text-xs">• Owner: {ownerId.slice(0, 8)}</span>
			{/if}
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
				{#each config.tags.slice(0, 3) as tag (tag)}
					<Badge variant="secondary">{tag}</Badge>
				{/each}
				{#if config.tags.length > 3}
					<span class="text-muted-foreground text-xs">+{config.tags.length - 3} more</span>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
