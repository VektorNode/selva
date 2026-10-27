<script lang="ts">
	import { getLocaleContext } from '../../i18n/localeContext.svelte';

	interface Props {
		show: boolean;
		/**
		 * `floating` overlays the bottom-left corner. `inline` is a compact chip the size of an
		 * icon button, for a narrow host whose corner holds its content and whose action row
		 * already reserves the chip's place. That host freezes while it solves, so the chip says
		 * Esc aborts: a frozen page can't offer a button.
		 */
		placement?: 'floating' | 'inline';
	}

	let { show, placement = 'floating' }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);
</script>

<!-- The live region stays mounted: a screen reader only announces text that changes inside a
     region it already knows about, so one created together with its text says nothing. -->
<div
	role="status"
	aria-live="polite"
	aria-atomic="true"
	class={placement === 'inline' ? 'h-10 gap-3 min-w-0 flex items-center' : undefined}
>
	{#if show && placement === 'inline'}
		<div
			class="gap-2 px-3 h-10 text-sm font-semibold flex shrink-0 items-center rounded-md bg-primary text-primary-foreground"
		>
			<div
				class="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
				aria-hidden="true"
			></div>
			{t.solvingEllipsis}
		</div>
		<span class="text-xs min-w-0 truncate text-muted-foreground" data-testid="solve-esc-hint">
			{t.solveMessagesEscHint}
		</span>
	{:else if show}
		<div
			class="bottom-6 left-6 gap-3 px-5 py-3 shadow-xl animate-in fade-in slide-in-from-left fixed z-50 flex items-center rounded-lg border border-primary/20 bg-primary text-primary-foreground duration-200"
		>
			<div class="h-5 w-5 relative flex shrink-0 items-center justify-center" aria-hidden="true">
				<div
					class="animate-ping absolute h-full w-full rounded-full bg-primary-foreground opacity-30"
				></div>
				<div
					class="h-3 w-3 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
				></div>
			</div>
			<div class="leading-tight flex flex-col">
				<span class="text-sm font-semibold">{t.solving}</span>
				<span class="text-xs opacity-70">{t.solvingSubtitle}</span>
			</div>
		</div>
	{/if}
</div>
