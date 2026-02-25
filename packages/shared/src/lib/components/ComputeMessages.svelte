<script lang="ts">
	import { CircleAlert, TriangleAlert, ChevronDown, ChevronRight } from '@lucide/svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Badge } from '$lib/components/ui/badge';

	interface Props {
		errors?: string[];
		warnings?: string[];
	}

	let { errors = [], warnings = [] }: Props = $props();

	let open = $state(false);

	let showErrors = $state(true);
	let showWarnings = $state(false);

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
	const hasMessages = $derived(errors.length > 0 || warnings.length > 0);
	const totalCount = $derived(errors.length + warnings.length);
</script>

{#if hasMessages}
	<!-- Floating Indicator Badge -->
	<Dialog.Root bind:open>
		<Dialog.Trigger class="bottom-1 right-2 fixed z-100 focus:outline-none">
			<div
				class="shadow-lg text-xs font-medium hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 flex cursor-pointer items-stretch overflow-hidden rounded-full border transition-all duration-150
					{errors.length > 0
					? 'text-destructive-foreground border-destructive/30 bg-destructive'
					: 'border-yellow-500/30 bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'}"
			>
				{#if errors.length > 0}
					<span class="gap-1.5 px-3 py-1.5 flex items-center">
						<CircleAlert class="h-3.5 w-3.5 shrink-0" />
						{errors.length}
					</span>
				{/if}
				{#if warnings.length > 0}
					{#if errors.length > 0}
						<span class="bg-destructive-foreground/20 w-px self-stretch"></span>
						<span class="gap-1.5 px-3 py-1.5 flex items-center bg-destructive/80">
							<TriangleAlert class="h-3.5 w-3.5 shrink-0" />
							{warnings.length}
						</span>
					{:else}
						<span class="gap-1.5 px-3 py-1.5 flex items-center">
							<TriangleAlert class="h-3.5 w-3.5 shrink-0" />
							{warnings.length}
						</span>
					{/if}
				{/if}
			</div>
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
								<div class="max-h-60 px-4 py-3 overflow-y-auto border-t border-destructive bg-card">
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
						<div class="border-yellow-500/50 overflow-hidden rounded-lg border bg-card">
							<div class="px-4 py-3 flex items-center">
								<Collapsible.Trigger
									class="hover:bg-yellow-500/5 -mx-4 -my-3 gap-3 px-4 py-3 flex flex-1 items-center text-left transition-colors"
								>
									{#if showWarnings}
										<ChevronDown class="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
									{:else}
										<ChevronRight class="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
									{/if}
									<TriangleAlert class="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0" />
									<span class="text-sm font-medium text-yellow-600 dark:text-yellow-500">
										{warnings.length === 1 ? '1 Warning' : `${warnings.length} Warnings`}
									</span>
								</Collapsible.Trigger>
							</div>

							<Collapsible.Content class="space-y-0">
								<div
									class="max-h-60 border-yellow-500/50 px-4 py-3 overflow-y-auto border-t bg-card"
								>
									<ul class="space-y-2">
										{#each groupedWarnings as { message, count } (message)}
											<li class="gap-2 text-sm flex text-muted-foreground">
												<span class="shrink-0">•</span>
												<span class="flex-1">
													{message}
													{#if count > 1}
														<span
															class="ml-1 font-medium text-yellow-600/70 dark:text-yellow-500/70"
															>×{count}</span
														>
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
