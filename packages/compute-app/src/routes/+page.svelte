<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { StateDisplay, Card, PageHeader } from '@selva/shared';
	import { ArrowRight } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	// Auto-redirect to app if only one definition or using URL mode
	$effect(() => {
		if (!data.definitions || data.definitions.length <= 1) {
			// Single definition or URL mode - redirect to app
			goto('/app', { replaceState: true });
		}
	});
</script>

{#if !data.definitions || data.definitions.length <= 1}
	<!-- Auto-redirecting for single definition or URL mode -->
	<div class="flex min-h-screen items-center justify-center">
		<div class="text-center">
			<div class="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-gray-900"></div>
			<p class="mt-4 text-gray-600">Loading...</p>
		</div>
	</div>
{:else}
	<div class="flex h-screen flex-col bg-background">
		<!-- Header -->
		<PageHeader title="Definitions" showModeToggle={true} />
		<p class="border-b border-border px-8 py-3 text-sm text-muted-foreground">Select a Grasshopper definition to get started</p>

		<!-- Definitions Grid -->
		<div class="flex-1 overflow-y-auto px-8 py-6 flex flex-col">
			{#if data.error}
				<StateDisplay type="error" size="medium" message={data.error} />
			{:else if data.definitions.length === 0}
				<StateDisplay type="empty" size="medium" message="No definitions found" />
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each data.definitions as definition (definition.filename)}
						<button
							onclick={() => goto(`/app?gh=${definition.filename}`)}
							class="group flex h-full flex-col overflow-hidden rounded-lg border border-border bg-card text-left transition-all hover:border-muted-foreground hover:shadow-lg"
						>
							{#if definition.coverImage}
								<div class="relative h-40 overflow-hidden bg-muted">
									<img
										src={definition.coverImage}
										alt={definition.displayName}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
								</div>
							{:else}
								<div class="h-40 bg-linear-to-br from-muted to-muted/70"></div>
							{/if}
							<div class="flex flex-1 flex-col p-4">
								<h3 class="mb-1.5 font-semibold text-foreground line-clamp-2 text-sm group-hover:text-primary">
									{definition.displayName}
								</h3>
								{#if definition.description}
									<p class="mb-3 text-xs text-muted-foreground line-clamp-2">
										{definition.description}
									</p>
								{/if}
								{#if definition.tags && definition.tags.length > 0}
									<div class="mb-3 flex flex-wrap gap-1.5">
										{#each definition.tags.slice(0, 2) as tag}
											<span class="inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
												{tag}
											</span>
										{/each}
										{#if definition.tags.length > 2}
											<span class="text-xs text-muted-foreground">+{definition.tags.length - 2}</span>
										{/if}
									</div>
								{/if}
								<div class="mt-auto flex items-center justify-between pt-2 text-xs text-muted-foreground group-hover:text-foreground">
									<span class="truncate">{definition.filename}</span>
									<ArrowRight class="ml-2 h-3.5 w-3.5 shrink-0 transition-all group-hover:translate-x-0.5" />
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<footer class="border-t border-border px-8 py-4 text-center text-sm text-muted-foreground">
			<p><span class="font-semibold text-foreground">Selva</span></p>
		</footer>
	</div>
{/if}
