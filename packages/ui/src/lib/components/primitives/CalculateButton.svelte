<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Button } from './button';
	import { Zap, Check, Loader, Play } from '@lucide/svelte';
	import { getLocaleContext } from '../../i18n/localeContext.svelte';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		hasPendingChanges: boolean;
		hasNeverSolved?: boolean;
		isSolving: boolean;
		oncalculate: () => void;
		/** Beside the button, sharing its row: the panel footer's actions menu. */
		trailing?: Snippet;
	}

	let {
		hasPendingChanges,
		hasNeverSolved = false,
		isSolving,
		oncalculate,
		trailing
	}: Props = $props();

	// The label below changes too, but a screen reader doesn't read a label change on a button
	// that has lost focus, so start and end of a solve go through a live region as well.
	let announcement = $state('');
	let wasSolving = false;
	$effect(() => {
		const solving = isSolving;
		untrack(() => {
			if (solving) announcement = t.solvingEllipsis;
			else if (wasSolving) announcement = hasPendingChanges ? '' : t.upToDate;
			wasSolving = solving;
		});
	});
</script>

<div class="bottom-0 mt-3 pb-3 pt-2 backdrop-blur-sm px-2 sticky border-t border-border/50">
	<span class="sr-only" role="status" aria-live="polite">{announcement}</span>
	<div class="gap-2 flex">
		<Button
			variant={hasPendingChanges ? 'default' : 'ghost'}
			size="lg"
			onclick={() => !isSolving && oncalculate()}
			disabled={!hasPendingChanges && !isSolving}
			aria-busy={isSolving}
			class="gap-2 font-medium min-w-0 flex-1 transition-all duration-200
			{hasPendingChanges && !isSolving ? 'shadow-md' : ''}
			{!hasPendingChanges && !isSolving ? 'text-muted-foreground' : ''}"
		>
			{#if isSolving}
				<Loader class="h-4 w-4 animate-spin" />
				{t.solvingEllipsis}
			{:else if hasNeverSolved}
				<Play class="h-4 w-4" />
				{t.pressToCalculate}
			{:else if hasPendingChanges}
				<Zap class="h-4 w-4" />
				{t.calculate}
			{:else}
				<Check class="h-4 w-4" />
				{t.upToDate}
			{/if}
		</Button>
		{@render trailing?.()}
	</div>
</div>
