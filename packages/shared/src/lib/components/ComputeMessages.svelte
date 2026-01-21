<script lang="ts">
	import { CircleAlert, TriangleAlert, ChevronDown, ChevronRight } from '@lucide/svelte';
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
		const grouped = new Map<string, number>();

		for (const msg of messages) {
			// Extract the base message without the component GUID
			const baseMsg = msg.replace(/\([a-f0-9-]{36}\)$/i, '(...)').trim();
			grouped.set(baseMsg, (grouped.get(baseMsg) || 0) + 1);
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
		<Dialog.Trigger
			class="hover:scale-110 fixed bottom-4 right-4 z-50 transition-transform focus:outline-none"
		>
			<Badge
				variant={errors.length > 0 ? 'destructive' : 'secondary'}
				class="shadow-lg cursor-pointer gap-1.5 px-2.5 py-1.5 text-xs"
			>
				{#if errors.length > 0}
					<CircleAlert class="h-3.5 w-3.5" />
				{:else}
					<TriangleAlert class="h-3.5 w-3.5" />
				{/if}
				<span class="font-medium">
					{#if errors.length > 0}
						{errors.length}
					{/if}
					{#if warnings.length > 0}
						{#if errors.length > 0}/{/if}{warnings.length}
					{/if}
				</span>
			</Badge>
		</Dialog.Trigger>

		<Dialog.Content class="max-w-2xl max-h-[80vh]">
			<Dialog.Header>
				<Dialog.Title class="flex items-center gap-2">
					<CircleAlert class="h-5 w-5" />
					Compute Messages
				</Dialog.Title>
				<Dialog.Description>
					{totalCount} {totalCount === 1 ? 'issue' : 'issues'} detected during solve
				</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-3 overflow-y-auto pr-2" style="max-height: calc(80vh - 180px);">
				<!-- Errors Section -->
				{#if errors.length > 0}
					<Collapsible.Root bind:open={showErrors}>
						<div class="overflow-hidden rounded-lg border border-destructive bg-card">
							<div class="flex items-center px-4 py-3">
								<Collapsible.Trigger
									class="hover:bg-destructive/5 -mx-4 -my-3 flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors"
								>
									{#if showErrors}
										<ChevronDown class="text-destructive h-4 w-4 shrink-0" />
									{:else}
										<ChevronRight class="text-destructive h-4 w-4 shrink-0" />
									{/if}
									<CircleAlert class="text-destructive h-4 w-4 shrink-0" />
									<span class="text-destructive text-sm font-medium">
										{errors.length === 1 ? '1 Error' : `${errors.length} Errors`}
									</span>
								</Collapsible.Trigger>
							</div>

							<Collapsible.Content class="space-y-0">
								<div class="border-destructive max-h-60 overflow-y-auto border-t bg-card px-4 py-3">
									<ul class="space-y-2">
										{#each groupedErrors as { message, count }}
											<li class="text-destructive/90 flex gap-2 text-sm">
												<span class="shrink-0">•</span>
												<span class="flex-1">
													{message}
													{#if count > 1}
														<span class="text-destructive/70 ml-1 font-medium">×{count}</span>
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
						<div class="overflow-hidden rounded-lg border border-yellow-500/50 bg-card">
							<div class="flex items-center px-4 py-3">
								<Collapsible.Trigger
									class="hover:bg-yellow-500/5 -mx-4 -my-3 flex flex-1 items-center gap-3 px-4 py-3 text-left transition-colors"
								>
									{#if showWarnings}
										<ChevronDown class="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
									{:else}
										<ChevronRight class="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
									{/if}
									<TriangleAlert class="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500" />
									<span class="text-sm font-medium text-yellow-600 dark:text-yellow-500">
										{warnings.length === 1 ? '1 Warning' : `${warnings.length} Warnings`}
									</span>
								</Collapsible.Trigger>
							</div>

							<Collapsible.Content class="space-y-0">
								<div class="max-h-60 overflow-y-auto border-t border-yellow-500/50 bg-card px-4 py-3">
									<ul class="space-y-2">
										{#each groupedWarnings as { message, count }}
											<li class="text-muted-foreground flex gap-2 text-sm">
												<span class="shrink-0">•</span>
												<span class="flex-1">
													{message}
													{#if count > 1}
														<span class="ml-1 font-medium text-yellow-600/70 dark:text-yellow-500/70"
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
