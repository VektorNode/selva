<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Label } from '@selvajs/ui';
	import ScopeChip from '../scope/ScopeChip.svelte';

	interface Props {
		label: string;
		/** Id of the control, so clicking the label focuses or toggles it. */
		for?: string;
		hint?: string;
		/** `inline` puts the control beside the label: for switches and other compact controls. */
		layout?: 'inline' | 'stacked';
		/** Marks a scoped setting that sits in a panel of another scope. */
		scope?: 'local' | 'compute';
		children: Snippet;
	}

	let { label, for: controlId, hint, layout = 'stacked', scope, children }: Props = $props();

	const SCOPE_CHIP_LABELS = { local: 'Local', compute: 'Compute' } as const;
</script>

{#snippet heading()}
	<div class="flex items-center gap-2">
		<Label for={controlId}>{label}</Label>
		{#if scope}
			<ScopeChip {scope} label={SCOPE_CHIP_LABELS[scope]} />
		{/if}
	</div>
{/snippet}

{#if layout === 'inline'}
	<div class="flex items-start justify-between gap-4">
		<div class="flex min-w-0 flex-col gap-1">
			{@render heading()}
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
		{@render heading()}
		{@render children()}
		{#if hint}
			<p class="text-muted-foreground text-xs">{hint}</p>
		{/if}
	</div>
{/if}
