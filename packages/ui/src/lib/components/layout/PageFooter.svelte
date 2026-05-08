<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Dialog from '$lib/components/primitives/dialog';
	import * as Collapsible from '$lib/components/primitives/collapsible';
	import { CircleAlert, TriangleAlert, ChevronDown, ChevronRight } from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { useFooter } from '$lib/contexts/footerContext.svelte';
	import FooterItemRenderer from './FooterItemRenderer.svelte';

	interface Props {
		errors?: string[];
		warnings?: string[];
		children?: Snippet;
	}

	let { errors = [], warnings = [], children }: Props = $props();

	let footerStore = (() => {
		try {
			return useFooter();
		} catch {
			return null;
		}
	})();

	const leftItems = $derived(
		footerStore
			? Array.from(footerStore.items.values())
					.filter((item) => item.position === 'left')
					.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			: []
	);
	const rightItems = $derived(
		footerStore
			? Array.from(footerStore.items.values())
					.filter((item) => item.position === 'right')
					.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
			: []
	);

	let _currentYear = new Date().getFullYear();
	let dialogOpen = $state(false);
	let showErrors = $state(true);
	let showWarnings = $state(false);

	const hasMessages = $derived(errors.length > 0 || warnings.length > 0);
	const totalCount = $derived(errors.length + warnings.length);

	function groupMessages(messages: string[]): Array<{ message: string; count: number }> {
		const grouped = new SvelteMap<string, number>();

		for (const msg of messages) {
			// Extract the base message without the component GUID
			const baseMsg = msg.replace(/\([a-f0-9-]{36}\)$/i, '(...)').trim();
			const currentCount = grouped.get(baseMsg) || 0;
			grouped.set(baseMsg, currentCount + 1);
		}

		return Array.from(grouped.entries())
			.map(([message, count]) => ({ message, count }))
			.sort((a, b) => b.count - a.count);
	}

	const groupedErrors = $derived(groupMessages(errors));
	const groupedWarnings = $derived(groupMessages(warnings));
</script>

<footer
	class="px-4 gap-4 text-xs h-7 flex shrink-0 items-center justify-between border-t border-border bg-background text-muted-foreground select-none"
>
	<!-- Left section: Status items + custom context items -->
	<div class="gap-4 flex items-center">
		<!-- Custom left items from context -->
		{#each leftItems as item (item.id)}
			<FooterItemRenderer {item} />
		{/each}

		{#if hasMessages}
			<Dialog.Root bind:open={dialogOpen}>
				<Dialog.Trigger
					class="gap-1.5 px-2 py-1 rounded flex cursor-pointer items-center transition-colors hover:bg-muted {errors.length >
					0
						? 'text-destructive hover:bg-destructive/10'
						: 'text-warning hover:bg-warning/10'}"
					title={`${totalCount} ${totalCount === 1 ? 'issue' : 'issues'}`}
				>
					{#if errors.length > 0}
						<CircleAlert class="h-3.5 w-3.5" />
						<span class="font-medium">{errors.length} Error{errors.length !== 1 ? 's' : ''}</span>
					{/if}

					{#if warnings.length > 0}
						{#if errors.length > 0}
							<span class="text-border">•</span>
						{/if}
						<TriangleAlert class="h-3.5 w-3.5" />
						<span class="font-medium"
							>{warnings.length} Warning{warnings.length !== 1 ? 's' : ''}</span
						>
					{/if}
				</Dialog.Trigger>

				<Dialog.Content class="max-w-2xl max-h-[80vh]">
					<Dialog.Header>
						<Dialog.Title class="gap-2 flex items-center">
							<CircleAlert class="h-5 w-5" />
							Compute Messages
						</Dialog.Title>
						<Dialog.Description>
							{totalCount}
							{totalCount === 1 ? 'issue' : 'issues'} detected during solve
						</Dialog.Description>
					</Dialog.Header>

					<div class="space-y-3 pr-2 overflow-y-auto" style="max-height: calc(80vh - 180px);">
						<!-- Errors Section -->
						{#if errors.length > 0}
							<Collapsible.Root bind:open={showErrors}>
								<div class="overflow-hidden rounded-lg border border-destructive bg-card">
									<div class="px-4 py-3 flex items-center">
										<Collapsible.Trigger
											class="-mx-4 -my-3 gap-3 px-4 py-3 flex flex-1 items-center text-left transition-colors hover:bg-destructive/5"
										>
											{#if showErrors}
												<ChevronDown class="h-4 w-4 shrink-0 text-destructive" />
											{:else}
												<ChevronRight class="h-4 w-4 shrink-0 text-destructive" />
											{/if}
											<CircleAlert class="h-4 w-4 shrink-0 text-destructive" />
											<span class="text-sm font-medium text-destructive">
												{errors.length === 1 ? '1 Error' : `${errors.length} Errors`}
											</span>
										</Collapsible.Trigger>
									</div>

									<Collapsible.Content class="space-y-0">
										<div
											class="max-h-60 px-4 py-3 overflow-y-auto border-t border-destructive bg-card"
										>
											<ul class="space-y-2">
												{#each groupedErrors as { message, count } (message)}
													<li class="gap-2 text-sm flex text-destructive/90">
														<span class="shrink-0">•</span>
														<span class="flex-1">
															{message}
															{#if count > 1}
																<span class="ml-1 font-medium text-destructive/70">×{count} </span>
															{/if}
														</span>
													</li>
												{/each}
											</ul>
										</div>
									</Collapsible.Content>
								</div>
							</Collapsible.Root>
						{/if}

						<!-- Warnings Section -->
						{#if warnings.length > 0}
							<Collapsible.Root bind:open={showWarnings}>
								<div class="overflow-hidden rounded-lg border border-warning/50 bg-card">
									<div class="px-4 py-3 flex items-center">
										<Collapsible.Trigger
											class="-mx-4 -my-3 gap-3 px-4 py-3 flex flex-1 items-center text-left transition-colors hover:bg-warning/5"
										>
											{#if showWarnings}
												<ChevronDown class="h-4 w-4 shrink-0 text-warning" />
											{:else}
												<ChevronRight class="h-4 w-4 shrink-0 text-warning" />
											{/if}
											<TriangleAlert class="h-4 w-4 shrink-0 text-warning" />
											<span class="text-sm font-medium text-warning">
												{warnings.length === 1 ? '1 Warning' : `${warnings.length} Warnings`}
											</span>
										</Collapsible.Trigger>
									</div>

									<Collapsible.Content class="space-y-0">
										<div
											class="max-h-60 px-4 py-3 overflow-y-auto border-t border-warning/50 bg-card"
										>
											<ul class="space-y-2">
												{#each groupedWarnings as { message, count } (message)}
													<li class="gap-2 text-sm flex text-muted-foreground">
														<span class="shrink-0">•</span>
														<span class="flex-1">
															{message}
															{#if count > 1}
																<span class="ml-1 font-medium text-warning/70">×{count}</span>
															{/if}
														</span>
													</li>
												{/each}
											</ul>
										</div>
									</Collapsible.Content>
								</div>
							</Collapsible.Root>
						{/if}
					</div>
				</Dialog.Content>
			</Dialog.Root>
		{/if}

		{#if children}
			<div class="gap-4 flex items-center">
				{@render children()}
			</div>
		{/if}
	</div>

	<!-- Right section: Custom items + Copyright -->
	<div class="gap-4 ml-auto flex items-center">
		<!-- Custom right items from context -->
		{#each rightItems as item (item.id)}
			<FooterItemRenderer {item} />
		{/each}

		<p>by Selva &copy; {_currentYear}</p>
	</div>
</footer>
