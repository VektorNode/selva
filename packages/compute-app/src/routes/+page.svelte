<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { StateDisplay, PageHeader, Badge, PageFooter } from '@selva/shared';
	import { ArrowRight, AlertCircle } from '@lucide/svelte';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';

	let { data }: { data: PageData } = $props();

	// Track which definition is being loaded
	let loadingDefinition = $state<string | null>(null);

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

		<!-- Definitions Grid -->
		<div class="flex flex-1 flex-col overflow-y-auto px-8 py-6">
			{#if data.error}
				<StateDisplay type="error" size="medium" message={data.error} />
			{:else if data.definitions.length === 0}
				<StateDisplay type="empty" size="medium" message="No definitions found" />
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each data.definitions as definition (definition.filename)}
						<button
							onclick={() => handleDefinitionClick(definition.filename)}
							disabled={loadingDefinition !== null}
							class="group border-border bg-card hover:border-muted-foreground relative flex h-full flex-col overflow-hidden rounded-lg border text-left transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
						>
							{#if definition.coverImage}
								<div class="bg-muted relative h-40 overflow-hidden">
									<img
										src={definition.coverImage}
										alt={definition.displayName}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
									{#if loadingDefinition === definition.filename}
										<div class="absolute inset-0 flex items-center justify-center bg-black/50">
											<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
										</div>
									{/if}
								</div>
							{:else}
								<div class="from-muted to-muted/70 relative h-40 bg-linear-to-br">
									{#if loadingDefinition === definition.filename}
										<div class="absolute inset-0 flex items-center justify-center bg-black/50">
											<div class="h-8 w-8 animate-spin rounded-full border-b-2 border-white"></div>
										</div>
									{/if}
								</div>
							{/if}
							<div class="flex flex-1 flex-col p-4">
								<h3
									class="text-foreground group-hover:text-primary mb-1.5 line-clamp-2 text-sm font-semibold"
								>
									{definition.displayName}
								</h3>
								{#if definition.description}
									<p class="text-muted-foreground mb-3 line-clamp-2 text-xs">
										{definition.description}
									</p>
								{/if}
								{#if definition.tags && definition.tags.length > 0}
									<div class="mb-3 flex flex-wrap gap-1.5">
										{#each definition.tags.slice(0, 2) as tag (tag)}
											<Badge variant="secondary">{tag}</Badge>
										{/each}
										{#if definition.tags.length > 2}
											<span class="text-muted-foreground text-xs"
												>+{definition.tags.length - 2}</span
											>
										{/if}
									</div>
								{/if}
								<div
									class="text-muted-foreground group-hover:text-foreground mt-auto flex items-center justify-between pt-2 text-xs"
								>
									<span class="truncate">{definition.filename}</span>
									<ArrowRight
										class="ml-2 h-3.5 w-3.5 shrink-0 transition-all group-hover:translate-x-0.5"
									/>
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<PageFooter />
	</div>
{/if}
