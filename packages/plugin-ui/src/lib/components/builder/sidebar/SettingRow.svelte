<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Label } from '@selvajs/ui';

	interface Props {
		label: string;
		/** Id of the control, so clicking the label focuses or toggles it. */
		for?: string;
		hint?: string;
		/** `inline` puts the control beside the label: for switches and other compact controls. */
		layout?: 'inline' | 'stacked';
		children: Snippet;
	}

	let { label, for: controlId, hint, layout = 'stacked', children }: Props = $props();
</script>

{#if layout === 'inline'}
	<div class="flex items-start justify-between gap-4">
		<div class="flex min-w-0 flex-col gap-1">
			<Label for={controlId}>{label}</Label>
			{#if hint}
				<p class="text-muted-foreground text-xs">{hint}</p>
			{/if}
		</div>
		<div class="shrink-0">
			{@render children()}
		</div>
	</div>
{:else}
	<div class="flex flex-col gap-1.5">
		<Label for={controlId}>{label}</Label>
		{@render children()}
		{#if hint}
			<p class="text-muted-foreground text-xs">{hint}</p>
		{/if}
	</div>
{/if}
