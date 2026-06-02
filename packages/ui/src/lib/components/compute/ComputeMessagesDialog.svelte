<script lang="ts">
	import type { Snippet } from 'svelte';
	import { CircleAlert, TriangleAlert, ChevronDown, ChevronRight } from '@lucide/svelte';
	import * as Collapsible from '$lib/components/primitives/collapsible';
	import * as Dialog from '$lib/components/primitives/dialog';
	import { groupMessages } from '$lib/utils/file-download';

	interface Props {
		errors?: string[];
		warnings?: string[];
		/** Renders inside Dialog.Trigger. */
		trigger: Snippet;
	}

	let { errors = [], warnings = [], trigger }: Props = $props();

	let open = $state(false);
	let showErrors = $state(true);
	let showWarnings = $state(false);

	const groupedErrors = $derived(groupMessages(errors));
	const groupedWarnings = $derived(groupMessages(warnings));
	const totalCount = $derived(errors.length + warnings.length);
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class="focus:outline-none">
		{@render trigger()}
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
							<div class="max-h-60 px-4 py-3 overflow-y-auto border-t border-warning/50 bg-card">
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
