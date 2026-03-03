<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { StateDisplay, PageHeader, Badge, PageFooter, Input } from '@selva/shared';
	import { ArrowRight, AlertCircle, Search, X } from '@lucide/svelte';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import DefinitionCard from '$lib/components/DefinitionCard.svelte';

	let { data }: { data: PageData } = $props();

	// Track which definition is being loaded
	let loadingDefinition = $state<string | null>(null);
	let searchQuery = $state('');

	// Check compute health periodically (every 5 seconds)
	const computeHealth = useComputeHealth();
	$effect(() => {
		computeHealth.startPeriodicCheck(5000);
		return () => computeHealth.stopPeriodicCheck();
	});

	// Compute badge configuration based on health status
	const badgeConfig = $derived.by(() => {
		if (computeHealth.status.status === 'checking') {
			return { label: 'Checking...', variant: 'compute' as const };
		}
		if (computeHealth.status.status === 'ok') {
			return { label: 'Compute Online', variant: 'connected' as const };
		}
		if (computeHealth.status.status === 'warning') {
			return { label: 'Compute Warning', variant: 'solving' as const };
		}
		return { label: 'Compute Offline', variant: 'disconnected' as const };
	});

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

	// Auto-redirect to app if only one definition or using URL mode
	$effect(() => {
		if (!data.definitions || data.definitions.length <= 1) {
			// Single definition or URL mode - redirect to app
			loadingDefinition = 'auto-redirect';
			goto('/app').catch(() => {});
		}
	});

	function handleDefinitionClick(filename: string) {
		loadingDefinition = filename;
		goto(`/app?gh=${filename}`).catch(() => {
			loadingDefinition = null;
		});
	}
</script>

{#if !data.definitions || data.definitions.length <= 1}
	<!-- Auto-redirecting for single definition or URL mode -->
	<div class="bg-background flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="border-foreground mx-auto h-12 w-12 animate-spin rounded-full border-b-2"></div>
			<p class="text-muted-foreground mt-4 text-sm">Loading...</p>
		</div>
	</div>
{:else}
	<div class="bg-background flex h-screen flex-col">
		<!-- Header -->
		<PageHeader title="Definitions" badge={badgeConfig} showModeToggle={true} />

		<!-- Compute Status Warning -->
		{#if computeHealth.status.status === 'error' || computeHealth.status.status === 'warning'}
			<div
				class="border-b px-8 py-3 {computeHealth.status.status === 'error'
					? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950'
					: 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950'}"
			>
				<div class="flex items-start gap-2">
					<AlertCircle
						class="mt-0.5 h-4 w-4 shrink-0 {computeHealth.status.status === 'error'
							? 'text-red-600 dark:text-red-400'
							: 'text-yellow-600 dark:text-yellow-400'}"
					/>
					<div class="flex-1">
						<p
							class="text-sm font-medium {computeHealth.status.status === 'error'
								? 'text-red-900 dark:text-red-100'
								: 'text-yellow-900 dark:text-yellow-100'}"
						>
							{computeHealth.status.status === 'error'
								? 'Rhino.Compute Server Offline'
								: 'Rhino.Compute Server Warning'}
						</p>
						<p
							class="mt-1 text-xs {computeHealth.status.status === 'error'
								? 'text-red-700 dark:text-red-300'
								: 'text-yellow-700 dark:text-yellow-300'}"
						>
							{computeHealth.status.message}
							{#if computeHealth.status.url}
								<span class="font-mono">({computeHealth.status.url})</span>
							{/if}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<p class="border-border text-muted-foreground border-b px-8 py-3 text-sm">
			Select a Grasshopper definition to get started
		</p>

		<!-- Search Bar -->
		<div class="border-border border-b px-8 py-4">
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

		<!-- Definitions Grid -->
		<div class="flex flex-1 flex-col overflow-y-auto px-8 py-6">
			{#if data.error}
				<StateDisplay type="error" size="medium" message={data.error} />
			{:else if filteredDefinitions.length === 0}
				<StateDisplay
					type="empty"
					size="medium"
					message={searchQuery ? 'No definitions match your search' : 'No definitions found'}
				/>
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

		<!-- Footer -->
		<PageFooter />
	</div>
{/if}
