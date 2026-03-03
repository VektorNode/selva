<script lang="ts">
	import { Badge, Card } from '@selva/shared';

	interface Definition {
		guid: string;
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

<button
	onclick={onSelect}
	disabled={isLoading}
	class="group h-full overflow-hidden rounded-lg text-left transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
>
	<Card.Root class="flex h-full flex-col pt-0">
		{#if definition.coverImage?.trim() && !imageError}
			<div class="bg-muted relative h-40 overflow-hidden">
				<img
					src={definition.coverImage}
					alt={definition.displayName}
					class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
					onerror={() => (imageError = true)}
				/>
				{#if isLoading}
					<div class="absolute inset-0 flex items-center justify-center bg-black/50">
						<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
					</div>
				{/if}
			</div>
		{:else}
			<div
				class="relative flex h-40 items-center justify-center bg-linear-to-br from-cyan-200 via-blue-200 to-indigo-300"
			>
				{#if isLoading}
					<div class="absolute inset-0 flex items-center justify-center bg-black/50">
						<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
					</div>
				{:else}
					<div class="text-muted-foreground text-sm font-medium opacity-40">No preview</div>
				{/if}
			</div>
		{/if}
		<Card.Header>
			<div class="flex items-start justify-between gap-2">
				<div class="flex-1">
					<Card.Title>
						{definition.displayName}
					</Card.Title>
					{#if definition.description}
						<Card.Description class="mt-1">{definition.description}</Card.Description>
					{/if}
				</div>
				{#if definition.category}
					<Badge variant="secondary">
						{definition.category}
					</Badge>
				{/if}
			</div>
		</Card.Header>
		<div class="border-border border-t"></div>
		<Card.Content class="flex flex-col gap-3 pt-3">
			{#if definition.tags && definition.tags.length > 0}
				<div class="flex flex-col gap-1">
					<p class="text-foreground text-xs font-semibold tracking-wider uppercase">Tags</p>
					<div class="flex flex-wrap gap-1.5">
						{#each definition.tags.slice(0, 4) as tag (tag)}
							<Badge variant="secondary" class="text-xs">{tag}</Badge>
						{/each}
						{#if definition.tags.length > 4}
							<Badge variant="outline" class="text-xs">+{definition.tags.length - 4}</Badge>
						{/if}
					</div>
				</div>
			{/if}

			<div class="flex flex-col gap-1">
				<p class="text-muted-foreground text-xs font-semibold tracking-wider uppercase">File</p>
				<p class="text-foreground truncate text-xs font-medium">
					{definition.originalFilename || definition.filename}
				</p>
			</div>
		</Card.Content>
	</Card.Root>
</button>
