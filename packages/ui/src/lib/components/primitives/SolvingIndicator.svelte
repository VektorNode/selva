<script lang="ts">
	import { getLocaleContext } from '../../i18n/localeContext.svelte';

	interface Props {
		show: boolean;
	}

	let { show }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);
</script>

{#if show}
	<div
		class="bottom-6 left-6 gap-3 px-5 py-3 shadow-xl animate-in fade-in slide-in-from-left fixed z-50 flex items-center rounded-lg border border-primary/20 bg-primary text-primary-foreground duration-200"
	>
		<div class="h-5 w-5 relative flex shrink-0 items-center justify-center">
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
