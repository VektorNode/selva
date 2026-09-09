<script lang="ts">
	// Blocks on the solve's messages until the user confirms them. The solve itself has already
	// finished — Grasshopper cannot be paused mid-solution — so what this gates is the *result*:
	// the session holds the outputs and meshes, and confirming releases them.

	import { CircleAlert, TriangleAlert, Info } from '@lucide/svelte';
	import * as Dialog from '$lib/components/primitives/dialog';
	import { Button } from '$lib/components/primitives/button';
	import { groupMessages } from '$lib/utils/file-download';

	interface Props {
		open: boolean;
		errors?: string[];
		warnings?: string[];
		/** The definition aborted this solve: there is no result behind the dialog to reveal. */
		blocked?: boolean;
		/** Apply the held result. */
		onconfirm: () => void;
		/** Throw the held result away, keeping what the viewer already shows. */
		ondiscard: () => void;
		labels?: {
			blockedTitle: string;
			messagesTitle: string;
			blockedDescription: string;
			messagesDescription: string;
			confirm: string;
			abort: string;
			dismiss: string;
		};
	}

	const DEFAULT_LABELS = {
		blockedTitle: 'Solve stopped',
		messagesTitle: 'Solve messages',
		blockedDescription: 'The definition stopped this solve. No results were produced.',
		messagesDescription: 'This solve reported the following.',
		confirm: 'Continue',
		abort: 'Abort',
		dismiss: 'Dismiss'
	};

	let {
		open,
		errors = [],
		warnings = [],
		blocked = false,
		onconfirm,
		ondiscard,
		labels = DEFAULT_LABELS
	}: Props = $props();

	const groupedErrors = $derived(groupMessages(errors));
	const groupedWarnings = $derived(groupMessages(warnings));

	// Escape and click-outside resolve to the safe side — discard, keeping what is on screen —
	// rather than silently applying a result the user never accepted. An aborted solve has
	// nothing to apply either way.
	function handleOpenChange(next: boolean) {
		if (!next) ondiscard();
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-lg max-h-[80vh]" data-testid="solve-message-dialog">
		<Dialog.Header>
			<Dialog.Title class="gap-2 flex items-center">
				{#if blocked || errors.length > 0}
					<CircleAlert class="h-5 w-5 text-destructive" />
				{:else}
					<TriangleAlert class="h-5 w-5 text-amber-500" />
				{/if}
				{blocked ? labels.blockedTitle : labels.messagesTitle}
			</Dialog.Title>
			<Dialog.Description>
				{blocked ? labels.blockedDescription : labels.messagesDescription}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3 pr-1 overflow-y-auto" style="max-height: calc(80vh - 200px);">
			{#if groupedErrors.length > 0}
				<ul class="space-y-2">
					{#each groupedErrors as { message, count } (message)}
						<li class="gap-2 text-sm flex text-destructive">
							<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
							<span class="flex-1">
								{message}{#if count > 1}<span class="opacity-70"> ({count}×)</span>{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			{#if groupedWarnings.length > 0}
				<ul class="space-y-2">
					{#each groupedWarnings as { message, count } (message)}
						<li class="gap-2 text-sm text-amber-600 dark:text-amber-500 flex">
							<Info class="mt-0.5 h-4 w-4 shrink-0" />
							<span class="flex-1">
								{message}{#if count > 1}<span class="opacity-70"> ({count}×)</span>{/if}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<Dialog.Footer>
			{#if blocked}
				<!-- The solution was aborted: there is no result to accept or reject. -->
				<Button variant="outline" onclick={ondiscard}>{labels.dismiss}</Button>
			{:else}
				<Button variant="outline" onclick={ondiscard}>{labels.abort}</Button>
				<Button variant="default" onclick={onconfirm}>{labels.confirm}</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
