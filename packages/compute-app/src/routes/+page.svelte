<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import { StateDisplay, PageHeader, PageContainer, Input, useFooterItem } from '@selva/shared';
	import { Search, X } from '@lucide/svelte';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import ComputeHealthFooter from '$lib/components/ComputeHealthFooter.svelte';
	import DefinitionCard from '$lib/components/DefinitionCard.svelte';

	let { data }: { data: PageData } = $props();

	// Track which definition is being loaded
	let loadingDefinition = $state<string | null>(null);
	let searchQuery = $state('');

	const computeHealth = useComputeHealth();
	onMount(() => computeHealth.startPeriodicCheck(10000));
	onDestroy(() => computeHealth.stopPeriodicCheck());

	// Register compute health in footer
	useFooterItem(
		'compute-health',
		ComputeHealthFooter,
		() => ({ status: computeHealth.status.status, message: computeHealth.status.message }),
		'left',
		20
	);

	// Filter definitions based on search query
	const filteredDefinitions = $derived.by(() => {
		if (!searchQuery.trim() || !data.definitions) {
			return data.definitions || [];
		}

		const query = searchQuery.toLowerCase();
		return data.definitions.filter((def) => {
			const displayNameMatch = def.displayName.toLowerCase().includes(query);
			const descriptionMatch = def.description?.toLowerCase().includes(query);
			const filenameMatch =
				def.filename.toLowerCase().includes(query) ||
				def.originalFilename?.toLowerCase().includes(query);
			const tagsMatch = def.tags?.some((tag) => tag.toLowerCase().includes(query));

			return displayNameMatch || descriptionMatch || filenameMatch || tagsMatch;
		});
	});

	function handleDefinitionClick(filename: string) {
		loadingDefinition = filename;
		goto(`/app?gh=${filename}`).catch(() => {
			loadingDefinition = null;
		});
	}
</script>

<PageContainer>
	<!-- Header -->
	<PageHeader title="Definitions" showModeToggle={true} />

	{#if data.definitions && data.definitions.length > 0}
		<p class="border-border text-muted-foreground border-b px-4 py-3 text-sm sm:px-8">
			Select a Grasshopper definition to get started
		</p>

		<!-- Search Bar -->
		<div class="border-border border-b px-4 py-4 sm:px-8">
			<div class="relative">
				<Search
					class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
				/>
				<Input
					type="text"
					placeholder="Search definitions by name, description, tags..."
					bind:value={searchQuery}
					class="pr-10 pl-10"
				/>
				{#if searchQuery}
					<button
						onclick={() => (searchQuery = '')}
						class="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
						aria-label="Clear search"
					>
						<X class="h-4 w-4" />
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Definitions Grid -->
	<div class="flex flex-1 flex-col overflow-y-auto px-4 py-6 sm:px-8">
		{#if data.error}
			<StateDisplay type="error" size="medium" message={data.error} />
		{:else if filteredDefinitions.length === 0}
			{#if searchQuery}
				<StateDisplay type="empty" size="medium" message="No definitions match your search" />
			{:else}
				<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
					<StateDisplay type="empty" size="medium" message="No definitions uploaded yet" />
					<p class="text-muted-foreground text-sm">
						Go to the <a
							href="/admin"
							class="text-foreground underline underline-offset-4 hover:opacity-75">admin panel</a
						> to upload a Grasshopper definition.
					</p>
				</div>
			{/if}
		{:else}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
				{#each filteredDefinitions as definition (definition.guid)}
					<DefinitionCard
						{definition}
						isLoading={loadingDefinition === definition.filename}
						onSelect={() => handleDefinitionClick(definition.guid)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</PageContainer>
