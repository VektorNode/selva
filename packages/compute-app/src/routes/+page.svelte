<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { StateDisplay, PageHeader } from '@selva/shared';
	import { ArrowRight } from '@lucide/svelte';

	let { data }: { data: PageData } = $props();

	// Auto-redirect to app if only one definition or using URL mode
	$effect(() => {
		if (!data.definitions || data.definitions.length <= 1) {
			// Single definition or URL mode - redirect to app
			goto('/app').catch(() => {});
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
	<div class="bg-background flex h-screen flex-col">
		<!-- Header -->
		<PageHeader title="Definitions" showModeToggle={true} />
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
							onclick={() => goto(`/app?gh=${definition.filename}`).catch(() => {})}
							class="group border-border bg-card hover:border-muted-foreground flex h-full flex-col overflow-hidden rounded-lg border text-left transition-all hover:shadow-lg"
						>
							{#if definition.coverImage}
								<div class="bg-muted relative h-40 overflow-hidden">
									<img
										src={definition.coverImage}
										alt={definition.displayName}
										class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
									/>
								</div>
							{:else}
								<div class="from-muted to-muted/70 h-40 bg-linear-to-br"></div>
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
											<span
												class="bg-muted text-muted-foreground inline-block rounded-full px-2 py-0.5 text-xs"
											>
												{tag}
											</span>
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
		<footer class="border-border text-muted-foreground border-t px-8 py-4 text-center text-sm">
			<p><span class="text-foreground font-semibold">Selva</span></p>
		</footer>
	</div>
{/if}
