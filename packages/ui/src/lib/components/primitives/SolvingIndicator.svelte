<script lang="ts">
	import { LoaderCircle } from '@lucide/svelte';
	import { getLocaleContext } from '../../i18n/localeContext.svelte';

	// Sits in a panel's action row, beside the controls that started the solve. Says Esc aborts,
	// as every host does.
	let { show }: { show: boolean } = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);
</script>

<!-- The live region stays mounted: a screen reader only announces text that changes inside a
     region it already knows about, so one created together with its text says nothing. -->
<div
	role="status"
	aria-live="polite"
	aria-atomic="true"
	class="h-9 gap-2 min-w-0 flex items-center"
>
	{#if show}
		<LoaderCircle class="h-4 w-4 animate-spin shrink-0 text-muted-foreground" aria-hidden="true" />
		<!-- Baseline, not centre: the two sizes centred put the smaller text visibly high. -->
		<div class="gap-2 min-w-0 flex items-baseline">
			<span class="text-sm font-medium shrink-0 text-foreground">{t.solvingEllipsis}</span>
			<span class="text-xs min-w-0 truncate text-muted-foreground" data-testid="solve-esc-hint">
				{t.solveMessagesEscHint}
			</span>
		</div>
	{/if}
</div>
